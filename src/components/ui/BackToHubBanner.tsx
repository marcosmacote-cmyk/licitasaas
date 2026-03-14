import { ArrowLeft } from 'lucide-react';

interface BackToHubBannerProps {
    processTitle?: string;
    onReturn: () => void;
}

/**
 * Reusable "Voltar ao Hub" banner shown at the top of modules
 * when the user navigated from the Hub Operacional.
 * Only rendered when hubOriginId is present.
 */
export function BackToHubBanner({ processTitle, onReturn }: BackToHubBannerProps) {
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 16px',
            background: 'color-mix(in srgb, var(--color-primary) 6%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-primary) 15%, transparent)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-3)',
        }}>
            <button
                type="button"
                onClick={onReturn}
                style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-primary)',
                    background: 'var(--color-bg-body)',
                    color: 'var(--color-primary)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-sm)',
                    fontWeight: 600,
                    transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-primary)'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg-body)'; e.currentTarget.style.color = 'var(--color-primary)'; }}
            >
                <ArrowLeft size={14} />
                Voltar ao Hub
            </button>
            {processTitle && (
                <span style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}>
                    {processTitle}
                </span>
            )}
        </div>
    );
}
