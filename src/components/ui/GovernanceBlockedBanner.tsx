import { ShieldOff, ArrowRight } from 'lucide-react';
import { getBlockedMessage, resolveStage, type KanbanStage, type SystemModule } from '../../governance';

interface GovernanceBlockedBannerProps {
    /** Status atual do processo (legado ou novo) */
    processStatus: string;
    /** Subfase operacional */
    substage?: string | null;
    /** Módulo tentado */
    module: SystemModule;
    /** Título do processo */
    processTitle?: string;
    /** Callback para navegar ao Hub */
    onGoToHub?: () => void;
}

/**
 * Banner de bloqueio institucional exibido quando um processo
 * não está elegível para o módulo acessado.
 */
export function GovernanceBlockedBanner({
    processStatus,
    substage,
    module,
    processTitle,
    onGoToHub,
}: GovernanceBlockedBannerProps) {
    const stage = resolveStage(processStatus);
    const message = getBlockedMessage(stage as KanbanStage, substage, module);

    return (
        <div style={{
            padding: 'var(--space-5) var(--space-6)',
            borderRadius: 'var(--radius-xl)',
            background: 'linear-gradient(135deg, rgba(239,68,68,0.04), rgba(239,68,68,0.08))',
            border: '1px solid rgba(239,68,68,0.18)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div style={{
                    width: 40, height: 40, borderRadius: 'var(--radius-lg)',
                    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                    <ShieldOff size={20} color="var(--color-danger)" />
                </div>
                <div>
                    <div style={{
                        fontSize: 'var(--text-md)', fontWeight: 700,
                        color: 'var(--color-danger)', lineHeight: 1.2,
                    }}>
                        Módulo indisponível para este processo
                    </div>
                    {processTitle && (
                        <div style={{
                            fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)',
                            marginTop: 2,
                        }}>
                            {processTitle}
                        </div>
                    )}
                </div>
            </div>

            <div style={{
                fontSize: 'var(--text-md)',
                color: 'var(--color-text-secondary)',
                lineHeight: 1.6,
                padding: 'var(--space-3) var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(239,68,68,0.03)',
            }}>
                {message}
            </div>

            <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)',
            }}>
                <span style={{
                    padding: '2px 8px', borderRadius: 'var(--radius-full)',
                    background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
                    fontSize: 'var(--text-xs)', fontWeight: 600,
                }}>
                    Fase atual: {stage}
                </span>
            </div>

            {onGoToHub && (
                <button
                    onClick={onGoToHub}
                    style={{
                        alignSelf: 'flex-start',
                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                        padding: 'var(--space-2) var(--space-4)',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-primary)',
                        color: 'white',
                        border: 'none',
                        fontSize: 'var(--text-sm)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        marginTop: 'var(--space-1)',
                    }}
                >
                    Abrir Hub Operacional <ArrowRight size={14} />
                </button>
            )}
        </div>
    );
}
