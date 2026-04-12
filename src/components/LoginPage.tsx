import { useState } from 'react';
import { Lock, Mail, Loader2, Building2, ArrowRight } from 'lucide-react';
import { API_BASE_URL } from '../config';

interface Props {
    onLoginSuccess: (userData: any) => void;
}

export function LoginPage({ onLoginSuccess }: Props) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    // Sprint 5: 2FA States
    const [requires2fa, setRequires2fa] = useState(false);
    const [tempToken, setTempToken] = useState('');
    const [totpCode, setTotpCode] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        try {
            const endpoint = requires2fa ? '/api/auth/2fa/verify' : '/api/auth/login-v2';
            const payload = requires2fa 
                ? { tempToken, code: totpCode }
                : { email, password };

            const response = await fetch(`${API_BASE_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await response.json();

            if (response.ok) {
                if (data.requires2fa) {
                    setRequires2fa(true);
                    setTempToken(data.tempToken);
                    setError('');
                } else {
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('user', JSON.stringify(data.user));
                    onLoginSuccess(data.user);
                }
            } else {
                setError(data.error || 'Falha ao realizar login');
            }
        } catch (err) {
            setError('Erro de conexão com o servidor');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="login-header">
                    <div className="login-logo">
                        <Building2 size={32} color="var(--color-primary)" />
                    </div>
                    <h1 className="login-title">LicitaSaaS</h1>
                    <p className="login-subtitle">Gestão Inteligente de Licitações</p>
                </div>

                <form onSubmit={handleSubmit} className="login-form">
                    {error && <div className="login-error">{error}</div>}

                    {requires2fa ? (
                        <>
                            <div className="login-input-group">
                                <label className="login-label" style={{ textAlign: 'center', width: '100%', marginBottom: 'var(--space-3)', color: 'var(--color-primary)' }}>
                                    Autenticação em Duas Etapas Exigida
                                </label>
                                <div className="login-input-wrapper">
                                    <Lock size={18} className="login-icon" />
                                    <input
                                        type="text"
                                        required
                                        value={totpCode}
                                        onChange={(e) => setTotpCode(e.target.value.replace(/[^0-9]/g, '').substring(0, 6))}
                                        className="login-input"
                                        placeholder="Código de 6 dígitos"
                                        style={{ textAlign: 'center', letterSpacing: '4px', fontSize: '18px' }}
                                    />
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="login-input-group">
                                <label className="login-label">E-mail</label>
                                <div className="login-input-wrapper">
                                    <Mail size={18} className="login-icon" />
                                    <input
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="login-input"
                                        placeholder="seu@email.com"
                                    />
                                </div>
                            </div>

                            <div className="login-input-group">
                                <label className="login-label">Senha</label>
                                <div className="login-input-wrapper">
                                    <Lock size={18} className="login-icon" />
                                    <input
                                        type="password"
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="login-input"
                                        placeholder="••••••••"
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    <button type="submit" disabled={isLoading} className="login-button">
                        {isLoading ? (
                            <Loader2 size={20} className="spinner" />
                        ) : (
                            <>
                                Entrar
                                <ArrowRight size={18} />
                            </>
                        )}
                    </button>
                </form>

                <div className="login-footer">
                    {requires2fa ? (
                        <p className="login-footer-text">
                            <a href="#" className="login-link" onClick={() => { setRequires2fa(false); setTotpCode(''); }}>Voltar ao Início</a>
                        </p>
                    ) : (
                        <p className="login-footer-text">
                            Esqueceu sua senha? <a href="#" className="login-link">Contate o suporte</a>
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
