import { KeyRound, Copy, Eye, EyeOff } from 'lucide-react';
import type { CompanyCredential } from '../../types';

interface CredentialMatcherProps {
    credentials: CompanyCredential[];
    portal: string;
    link: string;
    showPassword: Record<string, boolean>;
    setShowPassword: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    copiedField: string | null;
    handleCopy: (text: string, fieldId: string) => void;
}

export function CredentialMatcher({ credentials, portal, link, showPassword, setShowPassword, copiedField, handleCopy }: CredentialMatcherProps) {
    if (credentials.length === 0) return null;

    const normalizedPortal = (portal || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    const normalizedLink = (link || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');

    // Score each credential for match
    const scored = credentials.map(cred => {
        const cp = cred.platform.toLowerCase();
        const cu = (cred.url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
        let score = 0;

        // Exact URL match
        if (cu && normalizedPortal && (cu.includes(normalizedPortal) || normalizedPortal.includes(cu))) score += 10;
        if (cu && normalizedLink && (cu.includes(normalizedLink) || normalizedLink.includes(cu))) score += 10;
        // Platform name match
        if (cp && normalizedPortal && (cp.includes(normalizedPortal) || normalizedPortal.includes(cp))) score += 5;
        if (cp && normalizedLink && normalizedLink.includes(cp)) score += 5;
        // Partial domain match
        const portalDomain = normalizedPortal.split('/')[0];
        const credDomain = cu.split('/')[0];
        if (portalDomain && credDomain && (portalDomain.includes(credDomain) || credDomain.includes(portalDomain))) score += 8;

        return { cred, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const bestMatch = scored[0]?.score > 0 ? scored[0].cred.id : null;

    return (
        <div style={{
            marginTop: 'var(--space-3)',
            padding: 'var(--space-4) var(--space-5)',
            background: 'var(--color-ai-bg)',
            borderRadius: 'var(--radius-xl)',
            border: '1px solid var(--color-ai-border)'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-ai)', marginBottom: 'var(--space-3)' }}>
                <KeyRound size={16} />
                <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-base)' }}>Credenciais de Acesso ao Portal</span>
                {bestMatch && (
                    <span style={{
                        marginLeft: 'auto', padding: '3px 10px',
                        background: 'linear-gradient(135deg, var(--color-ai), var(--color-ai-hover))',
                        color: 'white', borderRadius: 'var(--radius-lg)',
                        fontSize: 'var(--text-xs)', fontWeight: 'var(--font-bold)',
                        display: 'flex', alignItems: 'center', gap: '4px'
                    }}>
                        ✨ IA identificou a credencial
                    </span>
                )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {scored.map(({ cred, score: _score }) => {
                    const isMatch = cred.id === bestMatch;
                    return (
                        <div key={cred.id} style={{
                            padding: isMatch ? 'var(--space-4)' : 'var(--space-3)',
                            background: isMatch ? 'var(--color-ai-bg)' : 'var(--color-bg-surface)',
                            borderRadius: 'var(--radius-lg)',
                            border: isMatch ? '2px solid var(--color-ai)' : '1px solid var(--color-border)',
                            display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
                            flexWrap: 'wrap', transition: 'var(--transition-fast)', position: 'relative'
                        }}>
                            {isMatch && (
                                <span style={{
                                    position: 'absolute', top: -8, right: 12,
                                    padding: '2px 8px', background: 'var(--color-success)',
                                    color: 'white', borderRadius: 'var(--radius-md)',
                                    fontSize: 'var(--text-xs)', fontWeight: 'var(--font-bold)'
                                }}>
                                    ✓ RECOMENDADA
                                </span>
                            )}
                            <div style={{ flex: '1 1 120px', minWidth: '120px' }}>
                                <span style={{
                                    fontSize: 'var(--text-xs)', fontWeight: 'var(--font-bold)',
                                    textTransform: 'uppercase',
                                    color: isMatch ? 'var(--color-ai)' : 'var(--color-text-tertiary)',
                                    letterSpacing: '0.05em'
                                }}>
                                    {cred.platform}
                                </span>
                                {cred.url && (
                                    <a href={cred.url} target="_blank" rel="noopener noreferrer" style={{
                                        display: 'block', fontSize: '0.72rem',
                                        color: isMatch ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                                        marginTop: '2px'
                                    }}>
                                        {cred.url.replace(/^https?:\/\//, '').slice(0, 40)}{cred.url.length > 45 ? '...' : ''}
                                    </a>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <div style={{
                                    padding: '6px 12px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)', fontSize: 'var(--text-base)',
                                    fontFamily: 'monospace', color: 'var(--color-text-primary)'
                                }}>
                                    {cred.login}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleCopy(cred.login, `login-${cred.id}`)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: copiedField === `login-${cred.id}` ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}
                                    title="Copiar login"
                                >
                                    <Copy size={14} />
                                </button>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <div style={{
                                    padding: '6px 12px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)', fontSize: '0.8125rem',
                                    fontFamily: 'monospace', color: 'var(--color-text-primary)', minWidth: '80px'
                                }}>
                                    {showPassword[cred.id] ? (cred.password || '***') : '••••••••'}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(prev => ({ ...prev, [cred.id]: !prev[cred.id] }))}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--color-text-tertiary)' }}
                                    title={showPassword[cred.id] ? 'Ocultar senha' : 'Mostrar senha'}
                                >
                                    {showPassword[cred.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleCopy(cred.password || '', `pass-${cred.id}`)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: copiedField === `pass-${cred.id}` ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}
                                    title="Copiar senha"
                                >
                                    <Copy size={14} />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
