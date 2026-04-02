/**
 * ══════════════════════════════════════════════════════════════
 * AiReportPdfExporter
 * Gera relatório PDF premium da análise de edital por IA.
 * Abre janela de impressão com layout profissional para envio
 * a interessados na análise.
 * ══════════════════════════════════════════════════════════════
 */

export interface ReportPdfData {
    // Header
    processTitle: string;
    confidence: string | null;
    scorePercentage: number | null;

    // Metadata
    metadata: {
        objeto: string | null;
        orgao: string | null;
        numeroProcesso: string | null;
        modalidade: string | null;
        criterioJulgamento: string | null;
        regimeExecucao: string | null;
        local: string | null;
        dataSessao: string | null;
        valorEstimado: string | null;
        fonteOficial: string | null;
    };

    // Content sections
    executiveSummary: string;
    risks: Array<{
        severity: string;
        title: string;
        text: string;
        action: string;
        sourceRef: string;
    }>;
    conditions: Array<{
        label: string;
        value: string;
        sourceRef: string;
        type: string;
    }>;
    categorizedDocs: Record<string, Array<{
        item: string;
        title: string;
        description: string;
        obligationType: string;
        phase: string;
        riskIfMissing: string;
        sourceRef: string;
        entryType: string;
        parentId: string | null;
    }>>;
    financialText: string;
    deadlineList: string[];
    penaltiesStructured: {
        advertencia: string[];
        multas: string[];
        impedimento: string[];
        inidoneidade: string[];
        rescisao: string[];
        outros: string[];
    } | null;
    penaltiesText: string;

    // Pipeline metrics
    pipelineDurationS: number | null;
    traceability: string;
    qualityScore: string | null;
    model: string | null;
}

const esc = (t: string) => (t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const SEVERITY_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
    critica: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', badge: '#dc2626' },
    alta: { bg: '#fff7ed', border: '#fdba74', text: '#9a3412', badge: '#ea580c' },
    media: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e', badge: '#d97706' },
    baixa: { bg: '#f0fdf4', border: '#86efac', text: '#166534', badge: '#16a34a' },
};

const OBL_LABELS: Record<string, string> = {
    obrigatoria_universal: 'Obrigatório',
    condicional: 'Condicional',
    se_aplicavel: 'Se aplicável',
    alternativa: 'Alternativa',
    vencedor: 'Só vencedor',
    fase_contratual: 'Contratual',
    consorcio: 'Consórcio',
    me_epp: 'ME/EPP',
    recuperacao_judicial: 'Rec. Judicial',
    empresa_estrangeira: 'Estrangeira',
};

const RISK_LABELS: Record<string, string> = {
    inabilitacao: '⚠ Risco: inabilitação',
    desclassificacao: '⚠ Risco: desclassificação',
    penalidade: '⚠ Risco: penalidade',
    risco_contratual: '⚠ Risco contratual',
};

export function exportAiReportPdf(data: ReportPdfData): Window | null {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        console.warn('[AiReportPdfExporter] Pop-up blocked.');
        return null;
    }

    const html = buildReportHtml(data);
    printWindow.document.write(html);
    printWindow.document.close();
    return printWindow;
}

function buildReportHtml(data: ReportPdfData): string {
    const now = new Date().toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    const confidenceColor = data.confidence === 'alta' ? '#22c55e' : data.confidence === 'media' ? '#eab308' : '#ef4444';

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>Relatório IA - ${esc(data.processTitle)}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        :root {
            --primary: #3b82f6;
            --primary-dark: #1d4ed8;
            --bg: #ffffff;
            --text: #1e293b;
            --text-secondary: #475569;
            --text-muted: #94a3b8;
            --border: #e2e8f0;
            --surface: #f8fafc;
            --success: #22c55e;
            --warning: #eab308;
            --danger: #ef4444;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', -apple-system, sans-serif; color: var(--text); line-height: 1.6; font-size: 10pt; background: var(--bg); }

        .page { padding: 24px 32px; max-width: 210mm; margin: 0 auto; }

        /* Cover / Header */
        .report-header {
            background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%);
            color: white;
            padding: 28px 32px;
            border-radius: 12px;
            margin-bottom: 20px;
            position: relative;
            overflow: hidden;
        }
        .report-header::before {
            content: '';
            position: absolute;
            top: -50%;
            right: -20%;
            width: 300px;
            height: 300px;
            background: radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%);
            border-radius: 50%;
        }
        .report-header .brand {
            font-size: 8pt;
            text-transform: uppercase;
            letter-spacing: 0.15em;
            color: rgba(255,255,255,0.5);
            margin-bottom: 6px;
            position: relative;
            z-index: 1;
        }
        .report-header .title {
            font-size: 16pt;
            font-weight: 800;
            letter-spacing: -0.02em;
            margin-bottom: 4px;
            position: relative;
            z-index: 1;
        }
        .report-header .title .ai {
            color: ${confidenceColor};
        }
        .report-header .subtitle {
            font-size: 9pt;
            color: rgba(255,255,255,0.7);
            max-width: 500px;
            line-height: 1.4;
            position: relative;
            z-index: 1;
        }
        .report-header .confidence-badge {
            position: absolute;
            top: 24px;
            right: 32px;
            z-index: 1;
            text-align: center;
        }
        .report-header .confidence-badge .score {
            font-size: 22pt;
            font-weight: 800;
            color: ${confidenceColor};
            line-height: 1;
        }
        .report-header .confidence-badge .label {
            font-size: 7pt;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: rgba(255,255,255,0.5);
            margin-top: 2px;
        }

        /* Section */
        .section { margin-bottom: 18px; page-break-inside: avoid; }
        .section-title {
            font-size: 10pt;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: var(--primary-dark);
            margin-bottom: 8px;
            padding-bottom: 4px;
            border-bottom: 2px solid var(--primary);
            display: flex;
            align-items: center;
            gap: 6px;
        }

        /* Metadata grid */
        .meta-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 6px 16px;
            background: var(--surface);
            padding: 12px 14px;
            border-radius: 8px;
            border: 1px solid var(--border);
        }
        .meta-grid .full-width { grid-column: 1 / -1; }
        .meta-label { font-size: 6.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
        .meta-value { font-size: 9pt; font-weight: 600; color: var(--text); line-height: 1.3; }

        /* Conditions */
        .condition-tag {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 20px;
            font-size: 7.5pt;
            font-weight: 600;
            margin: 2px 3px 2px 0;
        }
        .condition-block {
            padding: 8px 10px;
            border-radius: 6px;
            font-size: 8pt;
            line-height: 1.4;
            margin-bottom: 6px;
        }

        /* Summary */
        .summary-text {
            font-size: 9.5pt;
            line-height: 1.7;
            color: var(--text-secondary);
            text-align: justify;
            padding: 10px 14px;
            background: var(--surface);
            border-radius: 8px;
            border-left: 3px solid var(--primary);
        }

        /* Risk cards */
        .risk-card {
            padding: 8px 12px;
            border-radius: 8px;
            border-left: 3px solid;
            margin-bottom: 6px;
            page-break-inside: avoid;
        }
        .risk-severity {
            font-size: 6pt;
            font-weight: 800;
            text-transform: uppercase;
            padding: 1px 5px;
            border-radius: 3px;
            letter-spacing: 0.03em;
            display: inline-block;
            margin-right: 4px;
        }
        .risk-title { font-size: 9pt; font-weight: 700; display: inline; }
        .risk-text { font-size: 8.5pt; line-height: 1.4; margin-top: 3px; }
        .risk-action { font-size: 8pt; font-weight: 600; margin-top: 2px; }
        .risk-source { font-size: 7pt; margin-top: 2px; opacity: 0.8; }

        /* Requirements table */
        .req-category {
            font-size: 8pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--text-muted);
            margin: 10px 0 4px;
            padding-bottom: 2px;
            border-bottom: 1px solid var(--border);
        }
        .req-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 8pt;
            margin-bottom: 8px;
        }
        .req-table th {
            text-align: left;
            padding: 4px 6px;
            background: var(--surface);
            border-bottom: 2px solid var(--border);
            font-size: 7pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--text-muted);
        }
        .req-table td {
            padding: 4px 6px;
            border-bottom: 1px solid var(--border);
            vertical-align: top;
            line-height: 1.3;
        }
        .req-table .code { font-weight: 700; color: var(--primary); font-size: 7pt; white-space: nowrap; }
        .req-table .obl { font-size: 6pt; font-weight: 600; padding: 1px 4px; border-radius: 3px; white-space: nowrap; }
        .req-table .risk-label { font-size: 6.5pt; color: var(--danger); font-style: italic; }
        .req-table .source { font-size: 6.5pt; color: var(--text-muted); }
        .req-table .subitem { background: #f9fafb; }
        .req-table .subitem .code { color: var(--text-muted); }

        /* Financial & Deadlines */
        .info-block {
            padding: 10px 14px;
            border-radius: 8px;
            border: 1px solid;
            margin-bottom: 8px;
            font-size: 8.5pt;
            line-height: 1.5;
        }
        .info-block .block-title {
            font-weight: 700;
            font-size: 9pt;
            margin-bottom: 6px;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        /* Penalties */
        .penalty-group { margin-bottom: 6px; }
        .penalty-label { font-size: 7pt; font-weight: 700; text-transform: uppercase; margin-bottom: 2px; }
        .penalty-item { font-size: 8pt; line-height: 1.4; }

        /* Footer */
        .report-footer {
            margin-top: 16px;
            padding-top: 10px;
            border-top: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 7pt;
            color: var(--text-muted);
        }
        .report-footer .metrics {
            display: flex;
            gap: 16px;
        }
        .report-footer .metric { display: flex; flex-direction: column; align-items: center; }
        .report-footer .metric .value { font-weight: 800; font-size: 9pt; color: var(--text); }
        .report-footer .metric .label { font-size: 6pt; text-transform: uppercase; letter-spacing: 0.06em; }

        @media print {
            body { font-size: 9pt; }
            .page { padding: 0; max-width: none; }
            @page { size: A4 portrait; margin: 12mm 10mm; }
        }
    </style>
</head>
<body>
    <script>
    window.onload = function() { setTimeout(function() { window.print(); }, 600); };
    </script>

    <div class="page">
        <!-- HEADER -->
        <div class="report-header">
            <div class="brand">LicitaSaaS — Inteligência Artificial</div>
            <div class="title">Análise Estratégica <span class="ai">IA</span></div>
            <div class="subtitle">${esc(data.processTitle)}</div>
            ${data.scorePercentage !== null ? `
            <div class="confidence-badge">
                <div class="score">${data.scorePercentage}%</div>
                <div class="label">Confiança ${data.confidence || ''}</div>
            </div>
            ` : ''}
        </div>

        <!-- METADATA -->
        <div class="section">
            <div class="section-title">📋 Dados do Processo</div>
            <div class="meta-grid">
                ${data.metadata.objeto ? `<div class="full-width"><div class="meta-label">Objeto</div><div class="meta-value">${esc(data.metadata.objeto)}</div></div>` : ''}
                ${metaField('Órgão / Entidade', data.metadata.orgao)}
                ${metaField('Nº do Processo', data.metadata.numeroProcesso)}
                ${metaField('Modalidade', data.metadata.modalidade)}
                ${metaField('Critério de Julgamento', data.metadata.criterioJulgamento)}
                ${metaField('Regime de Execução', data.metadata.regimeExecucao)}
                ${metaField('Local', data.metadata.local)}
                ${metaField('Sessão', data.metadata.dataSessao)}
                ${metaField('Valor Estimado', data.metadata.valorEstimado)}
            </div>
            ${data.metadata.fonteOficial ? `<div style="font-size:7pt;color:var(--text-muted);margin-top:4px;">📄 ${esc(data.metadata.fonteOficial)}</div>` : ''}
        </div>

        <!-- CONDITIONS -->
        ${buildConditionsSection(data.conditions)}

        <!-- EXECUTIVE SUMMARY -->
        ${data.executiveSummary ? `
        <div class="section">
            <div class="section-title">📝 Resumo Executivo</div>
            <div class="summary-text">${esc(data.executiveSummary).replace(/\n/g, '<br>')}</div>
        </div>
        ` : ''}

        <!-- RISKS -->
        ${data.risks.length > 0 ? `
        <div class="section">
            <div class="section-title">⚠️ Riscos e Pontos Críticos</div>
            ${data.risks.map(r => {
                const sc = SEVERITY_COLORS[r.severity] || SEVERITY_COLORS.media;
                return `<div class="risk-card" style="background:${sc.bg};border-color:${sc.badge};">
                    <div>
                        <span class="risk-severity" style="background:${sc.badge}15;color:${sc.badge};">${esc(r.severity)}</span>
                        <span class="risk-title" style="color:${sc.text};">${esc(r.title)}</span>
                    </div>
                    ${r.text ? `<div class="risk-text" style="color:${sc.text};">${esc(r.text)}</div>` : ''}
                    ${r.action ? `<div class="risk-action" style="color:${sc.badge};">→ ${esc(r.action)}</div>` : ''}
                    ${r.sourceRef ? `<div class="risk-source" style="color:${sc.text};">📄 ${esc(r.sourceRef)}</div>` : ''}
                </div>`;
            }).join('')}
        </div>
        ` : ''}

        <!-- REQUIREMENTS -->
        ${buildRequirementsSection(data.categorizedDocs)}

        <!-- FINANCIAL -->
        ${data.financialText ? `
        <div class="section">
            <div class="section-title">💰 Condições Financeiras</div>
            <div class="info-block" style="background:#f0fdf4;border-color:#86efac;">
                <div style="color:#166534;white-space:pre-wrap;font-size:8.5pt;line-height:1.5;">${esc(data.financialText)}</div>
            </div>
        </div>
        ` : ''}

        <!-- DEADLINES -->
        ${data.deadlineList.length > 0 ? `
        <div class="section">
            <div class="section-title">📅 Cronograma</div>
            <div class="info-block" style="background:#eff6ff;border-color:#93c5fd;">
                ${data.deadlineList.map(dl => `<div style="color:#1e40af;margin-bottom:3px;">${esc(dl)}</div>`).join('')}
            </div>
        </div>
        ` : ''}

        <!-- PENALTIES -->
        ${buildPenaltiesSection(data.penaltiesStructured, data.penaltiesText)}

        <!-- FOOTER with Pipeline Metrics -->
        <div class="report-footer">
            <div style="display:flex;flex-direction:column;">
                <span>Relatório gerado por IA — LicitaSaaS</span>
                <span>${now}</span>
            </div>
            <div class="metrics">
                ${data.pipelineDurationS !== null ? `<div class="metric"><span class="value">${data.pipelineDurationS.toFixed(0)}s</span><span class="label">Tempo</span></div>` : ''}
                ${data.traceability ? `<div class="metric"><span class="value">${esc(data.traceability)}</span><span class="label">Rastreabilidade</span></div>` : ''}
                ${data.qualityScore ? `<div class="metric"><span class="value">${esc(data.qualityScore)}</span><span class="label">Qualidade</span></div>` : ''}
                ${data.model ? `<div class="metric"><span class="value">${esc(data.model)}</span><span class="label">Modelo</span></div>` : ''}
            </div>
        </div>
    </div>
</body>
</html>`;
}

function metaField(label: string, value: string | null): string {
    if (!value) return '';
    return `<div><div class="meta-label">${esc(label)}</div><div class="meta-value">${esc(value)}</div></div>`;
}

function buildConditionsSection(conditions: ReportPdfData['conditions']): string {
    if (!conditions || conditions.length === 0) return '';

    const vedacoes = conditions.filter(c => c.label.startsWith('Vedação'));
    const others = conditions.filter(c => !c.label.startsWith('Vedação'));

    let html = '<div class="section"><div class="section-title">📌 Condições de Participação</div>';

    if (others.length > 0) {
        html += '<div style="margin-bottom:6px;">';
        others.forEach(c => {
            const truncated = (c.value || '').length > 200 ? c.value.slice(0, 200) + '...' : c.value;
            if (truncated.length <= 100) {
                html += `<span class="condition-tag" style="background:${c.type === 'danger' ? '#fef2f2' : c.type === 'warning' ? '#fffbeb' : '#f1f5f9'};color:${c.type === 'danger' ? '#991b1b' : c.type === 'warning' ? '#92400e' : '#475569'};border:1px solid ${c.type === 'danger' ? '#fca5a5' : c.type === 'warning' ? '#fcd34d' : '#e2e8f0'};">
                    ${esc(c.label)}: ${esc(truncated)}${c.sourceRef && c.sourceRef !== 'referência não localizada' ? ` <span style="font-size:6pt;opacity:0.7;">📄 ${esc(c.sourceRef)}</span>` : ''}
                </span>`;
            } else {
                html += `<div class="condition-block" style="background:${c.type === 'warning' ? '#fffbeb' : '#f8fafc'};border:1px solid ${c.type === 'warning' ? '#fcd34d' : '#e2e8f0'};">
                    <div style="font-weight:700;margin-bottom:2px;">${esc(c.label)}${c.sourceRef && c.sourceRef !== 'referência não localizada' ? ` <span style="font-size:6pt;opacity:0.7;">📄 ${esc(c.sourceRef)}</span>` : ''}</div>
                    <div>${esc(truncated)}</div>
                </div>`;
            }
        });
        html += '</div>';
    }

    if (vedacoes.length > 0) {
        html += `<div class="condition-block" style="background:#fffbeb;border:1px solid #fcd34d;">
            <div style="font-weight:700;margin-bottom:4px;color:#92400e;">🚫 Vedações de Participação (${vedacoes.length})</div>
            ${vedacoes.map(v => `<div style="margin-bottom:1px;color:#92400e;">• ${esc(v.value)}</div>`).join('')}
        </div>`;
    }

    html += '</div>';
    return html;
}

function buildRequirementsSection(categorizedDocs: ReportPdfData['categorizedDocs']): string {
    const entries = Object.entries(categorizedDocs);
    if (entries.length === 0) return '';

    let html = '<div class="section"><div class="section-title">✅ Habilitação Requerida</div>';

    for (const [category, docs] of entries) {
        const principals = docs.filter(d => !d.entryType || d.entryType === 'exigencia_principal');
        const children = docs.filter(d => d.entryType && d.entryType !== 'exigencia_principal');

        const childrenByParent: Record<string, typeof children> = {};
        children.forEach(c => {
            const pid = c.parentId || '__orphan__';
            if (!childrenByParent[pid]) childrenByParent[pid] = [];
            childrenByParent[pid].push(c);
        });

        html += `<div class="req-category">${esc(category)} (${principals.length})</div>`;
        html += '<table class="req-table"><thead><tr><th style="width:50px;">Código</th><th style="width:60px;">Status</th><th>Exigência</th><th style="width:100px;">Risco</th><th style="width:90px;">Referência</th></tr></thead><tbody>';

        for (const doc of principals) {
            const oblLabel = OBL_LABELS[doc.obligationType] || 'Obrigatório';
            const oblColor = doc.obligationType === 'obrigatoria_universal' ? '#22c55e' : doc.obligationType === 'condicional' ? '#3b82f6' : '#94a3b8';
            const riskLabel = RISK_LABELS[doc.riskIfMissing] || '';

            html += `<tr>
                <td class="code">${esc(doc.item)}</td>
                <td><span class="obl" style="background:${oblColor}15;color:${oblColor};">${esc(oblLabel)}</span></td>
                <td>
                    <strong>${esc(doc.title)}</strong>
                    ${doc.description ? `<br><span style="font-size:7.5pt;color:var(--text-secondary);">${esc(doc.description.slice(0, 200))}${doc.description.length > 200 ? '…' : ''}</span>` : ''}
                </td>
                <td class="risk-label">${esc(riskLabel)}</td>
                <td class="source">${doc.sourceRef ? '📄 ' + esc(doc.sourceRef) : ''}</td>
            </tr>`;

            // Children
            const myChildren = childrenByParent[doc.item] || [];
            for (const child of myChildren) {
                const icon = child.entryType === 'subitem' ? '↳' : child.entryType === 'observacao' ? '📝' : '📎';
                html += `<tr class="subitem">
                    <td class="code">${icon} ${esc(child.item || '')}</td>
                    <td><span style="font-size:5.5pt;color:var(--text-muted);text-transform:uppercase;">${esc(child.entryType)}</span></td>
                    <td>${esc(child.title || '')}${child.description ? ` — <span style="color:var(--text-secondary);">${esc(child.description.slice(0, 150))}${child.description.length > 150 ? '…' : ''}</span>` : ''}</td>
                    <td></td>
                    <td class="source">${child.sourceRef ? '📄 ' + esc(child.sourceRef) : ''}</td>
                </tr>`;
            }
        }

        html += '</tbody></table>';
    }

    html += '</div>';
    return html;
}

function buildPenaltiesSection(structured: ReportPdfData['penaltiesStructured'], text: string): string {
    if (!structured && !text) return '';

    let html = '<div class="section"><div class="section-title">⚖️ Penalidades</div>';

    if (structured) {
        const groups = [
            { label: '⚠️ Advertência', items: structured.advertencia },
            { label: '💰 Multas', items: structured.multas },
            { label: '⛔ Impedimento de Licitar e Contratar', items: structured.impedimento },
            { label: '🛑 Declaração de Inidoneidade', items: structured.inidoneidade },
            { label: '📋 Rescisão', items: structured.rescisao },
            { label: '📎 Outras', items: structured.outros },
        ];

        for (const g of groups) {
            if (g.items.length === 0) continue;
            html += `<div class="penalty-group">
                <div class="penalty-label" style="color:#991b1b;">${g.label}</div>
                ${g.items.map(item => `<div class="penalty-item" style="color:#7f1d1d;">• ${esc(item)}</div>`).join('')}
            </div>`;
        }
    } else if (text) {
        html += `<div style="font-size:8.5pt;color:#991b1b;white-space:pre-wrap;line-height:1.5;">${esc(text)}</div>`;
    }

    html += '</div>';
    return html;
}
