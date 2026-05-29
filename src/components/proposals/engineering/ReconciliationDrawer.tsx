import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, CheckCircle2, XCircle, AlertTriangle, AlertCircle, RefreshCw, ShieldAlert, BadgeCheck } from 'lucide-react';
import type { ReconciliationReport, ReconciliationAlert } from '../../../../server/services/engineering/reconciliationService';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    proposalId: string;
    onReconciled: () => void;
}

const token = () => localStorage.getItem('token') || '';
const hdrs = () => ({ 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' });

export function ReconciliationDrawer({ isOpen, onClose, proposalId, onReconciled }: Props) {
    const [report, setReport] = useState<ReconciliationReport | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isResolvingMap, setIsResolvingMap] = useState<Record<string, boolean>>({});
    const [isResolvingAll, setIsResolvingAll] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const fetchReport = useCallback(async () => {
        setIsLoading(true);
        setErrorMsg(null);
        try {
            const res = await fetch(`/api/engineering/proposals/${proposalId}/reconciliation-report`, { headers: hdrs() });
            if (!res.ok) throw new Error('Não foi possível carregar o relatório de conciliação');
            const data = await res.json();
            setReport(data);
        } catch (e: any) {
            console.error(e);
            setErrorMsg(e.message);
        } finally {
            setIsLoading(false);
        }
    }, [proposalId]);

    useEffect(() => {
        if (isOpen) {
            fetchReport();
        }
    }, [isOpen, fetchReport]);

    const handleResolve = async (alert: ReconciliationAlert) => {
        setIsResolvingMap(prev => ({ ...prev, [alert.id]: true }));
        try {
            const res = await fetch(`/api/engineering/proposals/${proposalId}/reconcile`, {
                method: 'POST',
                headers: hdrs(),
                body: JSON.stringify({ actionType: alert.suggestedAction.actionType, alertId: alert.id })
            });
            if (!res.ok) throw new Error('Erro ao aplicar correção');
            
            // Reload report and trigger parent reload
            await fetchReport();
            onReconciled();
        } catch (e: any) {
            window.alert(e.message);
        } finally {
            setIsResolvingMap(prev => ({ ...prev, [alert.id]: false }));
        }
    };

    const handleResolveAll = async () => {
        if (!report || report.alerts.length === 0) return;
        setIsResolvingAll(true);
        try {
            const res = await fetch(`/api/engineering/proposals/${proposalId}/reconcile`, {
                method: 'POST',
                headers: hdrs(),
                body: JSON.stringify({ actionType: 'RESOLVE_ALL' }) // backend resolves all report alerts
            });
            if (!res.ok) throw new Error('Erro ao reconciliar proposta');
            
            await fetchReport();
            onReconciled();
        } catch (e: any) {
            window.alert(e.message);
        } finally {
            setIsResolvingAll(false);
        }
    };

    if (!isOpen) return null;

    const summary = report?.summary || { totalAlerts: 0, criticalCount: 0, warningCount: 0, infoCount: 0, reconciliationScore: 100 };
    const score = summary.reconciliationScore;

    // Color based on health score
    const scoreColor = score >= 90 ? 'var(--color-success)' : score >= 70 ? '#f59e0b' : 'var(--color-danger)';
    const scoreBg = score >= 90 ? 'rgba(34,197,94,0.08)' : score >= 70 ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)';

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', justifyContent: 'flex-end',
            animation: 'fadeIn 0.2s ease-out'
        }}>
            {/* Backdrop */}
            <div style={{
                position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
                transition: 'opacity 0.25s'
            }} onClick={onClose} />

            {/* Panel */}
            <div style={{
                position: 'relative', width: '560px', maxWidth: '100%', height: '100%',
                background: 'var(--color-bg-surface)', boxShadow: '-10px 0 30px rgba(0,0,0,0.15)',
                display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--color-border)',
                animation: 'slideLeft 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px 24px', borderBottom: '1px solid var(--color-border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ background: scoreBg, padding: 8, borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center' }}>
                            <ShieldAlert size={20} color={scoreColor} />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Central de Conciliação</h3>
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>PACS · Auditoria de Consistência</span>
                        </div>
                    </div>
                    <button className="prop-icon-btn" onClick={onClose} style={{ padding: 6, borderRadius: '50%' }}>
                        <X size={18} />
                    </button>
                </div>

                {/* Content Area */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {isLoading && !report && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', gap: 12 }}>
                            <Loader2 size={32} className="spin" color="var(--color-primary)" />
                            <span style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Analisando integridade do orçamento...</span>
                        </div>
                    )}

                    {errorMsg && (
                        <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', padding: '16px', borderRadius: 'var(--radius-md)', color: 'var(--color-danger)', fontSize: '0.85rem' }}>
                            <AlertCircle size={16} style={{ display: 'inline', verticalAlign: -3, marginRight: 6 }} /> {errorMsg}
                            <button className="btn btn-outline" onClick={fetchReport} style={{ marginTop: 10, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                <RefreshCw size={13} /> Tentar novamente
                            </button>
                        </div>
                    )}

                    {report && (
                        <>
                            {/* Health Gauge Card */}
                            <div style={{
                                background: scoreBg, border: `1px solid ${scoreColor}25`,
                                borderRadius: 'var(--radius-lg)', padding: '18px 20px',
                                display: 'flex', alignItems: 'center', justifyItems: 'space-between', gap: 20
                            }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', color: scoreColor, letterSpacing: '0.05em', marginBottom: 4 }}>Índice de Consistência</div>
                                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>{score}%</div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', marginTop: 4, lineHeight: 1.3 }}>
                                        {score === 100 
                                            ? 'Orçamento 100% consistente! Não há desalinhamentos entre a planilha e as composições.' 
                                            : `Encontramos ${summary.totalAlerts} desvios. Recomendamos a reconciliação para evitar falhas em relatórios ou exportações.`}
                                    </div>
                                </div>
                                <div style={{
                                    width: 72, height: 72, borderRadius: '50%', border: `6px solid ${scoreColor}15`,
                                    borderTopColor: scoreColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontWeight: 800, color: scoreColor, fontSize: '1.1rem', transform: 'rotate(-45deg)'
                                }}>
                                    <div style={{ transform: 'rotate(45deg)' }}>
                                        {score === 100 ? <BadgeCheck size={36} color="var(--color-success)" /> : `${score}%`}
                                    </div>
                                </div>
                            </div>

                            {/* Actions Header */}
                            {summary.totalAlerts > 0 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text-secondary)' }}>Frequência de Inconsistências ({summary.totalAlerts})</span>
                                    <button className="btn btn-primary btn-sm" onClick={handleResolveAll} disabled={isResolvingAll} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', padding: '6px 14px' }}>
                                        {isResolvingAll ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
                                        Reconciliar Tudo
                                    </button>
                                </div>
                            )}

                            {/* List of Alerts */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {report.alerts.map((alert) => {
                                    const isResolving = isResolvingMap[alert.id];
                                    const badgeColor = alert.severity === 'CRITICAL' ? 'var(--color-danger)' : alert.severity === 'WARNING' ? '#d97706' : 'var(--color-primary)';
                                    const badgeBg = alert.severity === 'CRITICAL' ? 'rgba(239,68,68,0.06)' : alert.severity === 'WARNING' ? 'rgba(245,158,11,0.06)' : 'rgba(37,99,235,0.06)';
                                    const AlertIcon = alert.severity === 'CRITICAL' ? XCircle : alert.severity === 'WARNING' ? AlertTriangle : AlertCircle;

                                    return (
                                        <div key={alert.id} style={{
                                            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
                                            background: 'var(--color-bg-surface)', padding: '16px',
                                            display: 'flex', flexDirection: 'column', gap: 12,
                                            boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
                                            transition: 'transform 0.2s, box-shadow 0.2s',
                                        }}>
                                            {/* Top info */}
                                            <div style={{ display: 'flex', justifyItems: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                                                <div style={{ background: badgeBg, padding: 6, borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center' }}>
                                                    <AlertIcon size={15} color={badgeColor} />
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                                        <span style={{ fontSize: '0.62rem', fontWeight: 800, color: badgeColor, background: badgeBg, padding: '2px 6px', borderRadius: 4, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                            {alert.type.replace(/_/g, ' ')}
                                                        </span>
                                                        {alert.itemNumber && (
                                                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--color-text-tertiary)' }}>
                                                                Item {alert.itemNumber}
                                                            </span>
                                                        )}
                                                        {alert.code && (
                                                            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-tertiary)', background: 'var(--color-bg-base)', padding: '1px 5px', borderRadius: 3, fontFamily: 'var(--font-mono)' }}>
                                                                {alert.code}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-primary)', marginTop: 6, lineHeight: 1.3 }}>
                                                        {alert.description}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Details Message */}
                                            <div style={{
                                                fontSize: '0.78rem', color: 'var(--color-text-secondary)',
                                                background: 'var(--color-bg-base)', padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                                                lineHeight: 1.4
                                            }}>
                                                {alert.message}
                                            </div>

                                            {/* Action footer */}
                                            <div style={{ display: 'flex', justifyItems: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                                                    Atual: <span style={{ fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                                                        {typeof alert.actualValue === 'number' ? `R$ ${alert.actualValue.toFixed(2)}` : alert.actualValue}
                                                    </span> · Correção: <span style={{ fontWeight: 700, color: 'var(--color-success)' }}>
                                                        {typeof alert.expectedValue === 'number' ? `R$ ${alert.expectedValue.toFixed(2)}` : alert.expectedValue}
                                                    </span>
                                                </div>
                                                <button className="btn btn-outline btn-sm" onClick={() => handleResolve(alert)} disabled={isResolving} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', padding: '5px 12px' }}>
                                                    {isResolving ? <Loader2 size={12} className="spin" /> : <CheckCircle2 size={12} />}
                                                    {alert.suggestedAction.label}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}

                                {report.alerts.length === 0 && (
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', gap: 12, border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
                                        <div style={{ background: 'rgba(34,197,94,0.08)', padding: 12, borderRadius: '50%', display: 'flex', alignItems: 'center' }}>
                                            <CheckCircle2 size={32} color="var(--color-success)" />
                                        </div>
                                        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>Nenhuma inconsistência encontrada</span>
                                        <span style={{ fontSize: '0.76rem', color: 'var(--color-text-tertiary)', textAlign: 'center', maxWidth: 320 }}>
                                            O orçamento, as composições analíticas e as bases de preços oficiais estão perfeitamente sincronizados.
                                        </span>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '16px 24px', borderTop: '1px solid var(--color-border)',
                    background: 'var(--color-bg-base)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>PACS Engine V1.0</span>
                    </div>
                    <button className="btn btn-outline btn-sm" onClick={onClose}>Fechar Painel</button>
                </div>
            </div>

            {/* Keyframe animations injected inline */}
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideLeft {
                    from { transform: translateX(100%); }
                    to { transform: translateX(0); }
                }
            `}</style>
        </div>
    );
}
