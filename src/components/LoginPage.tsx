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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            const data = await response.json();

            if (response.ok) {
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                onLoginSuccess(data.user);
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
        <div style={containerStyle}>
            <div style={cardStyle}>
                <div style={headerStyle}>
                    <div style={logoContainerStyle}>
                        <Building2 size={32} color="var(--color-primary)" />
                    </div>
                    <h1 style={titleStyle}>LicitaSaaS</h1>
                    <p style={subtitleStyle}>Gestão Inteligente de Licitações</p>
                </div>

                <form onSubmit={handleSubmit} style={formStyle}>
                    {error && <div style={errorStyle}>{error}</div>}

                    <div style={inputGroupStyle}>
                        <label style={labelStyle}>E-mail</label>
                        <div style={inputWrapperStyle}>
                            <Mail size={18} style={iconStyle} />
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                style={inputStyle}
                                placeholder="seu@email.com"
                            />
                        </div>
                    </div>

                    <div style={inputGroupStyle}>
                        <label style={labelStyle}>Senha</label>
                        <div style={inputWrapperStyle}>
                            <Lock size={18} style={iconStyle} />
                            <input
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                style={inputStyle}
                                placeholder="••••••••"
                            />
                        </div>
                    </div>

                    <button type="submit" disabled={isLoading} style={buttonStyle}>
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

                <div style={footerStyle}>
                    <p style={footerTextStyle}>
                        Esqueceu sua senha? <a href="#" style={linkStyle}>Contate o suporte</a>
                    </p>
                </div>
            </div>
        </div>
    );
}

// Styles
const containerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: 'var(--color-bg-base)',
    padding: 'var(--space-6)',
};

const cardStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: '400px',
    backgroundColor: 'var(--color-bg-surface)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-xl)',
    padding: 'var(--space-10)',
    display: 'flex',
    flexDirection: 'column',
};

const headerStyle: React.CSSProperties = {
    textAlign: 'center',
    marginBottom: 'var(--space-8)',
};

const logoContainerStyle: React.CSSProperties = {
    width: '64px',
    height: '64px',
    backgroundColor: 'var(--color-primary-light)',
    borderRadius: 'var(--radius-xl)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto var(--space-4)',
};

const titleStyle: React.CSSProperties = {
    fontSize: 'var(--text-3xl)',
    fontWeight: 'var(--font-bold)',
    color: 'var(--color-text-primary)',
    marginBottom: 'var(--space-2)',
};

const subtitleStyle: React.CSSProperties = {
    fontSize: 'var(--text-base)',
    color: 'var(--color-text-secondary)',
};

const formStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-5)',
};

const inputGroupStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
};

const labelStyle: React.CSSProperties = {
    fontSize: 'var(--text-base)',
    fontWeight: 'var(--font-medium)',
    color: 'var(--color-text-secondary)',
};

const inputWrapperStyle: React.CSSProperties = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
};

const iconStyle: React.CSSProperties = {
    position: 'absolute',
    left: 'var(--space-3)',
    color: 'var(--color-text-tertiary)',
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: 'var(--space-3) var(--space-3) var(--space-3) var(--space-10)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    fontSize: 'var(--text-base)',
    outline: 'none',
    transition: 'var(--transition-fast)',
};

const buttonStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    padding: 'var(--space-3)',
    backgroundColor: 'var(--color-primary)',
    color: '#ffffff',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--text-lg)',
    fontWeight: 'var(--font-semibold)',
    cursor: 'pointer',
    transition: 'var(--transition-fast)',
    marginTop: 'var(--space-2)',
};

const errorStyle: React.CSSProperties = {
    padding: 'var(--space-3)',
    backgroundColor: 'var(--color-danger-bg)',
    color: 'var(--color-danger-hover)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--text-base)',
    textAlign: 'center',
    border: '1px solid var(--color-danger-border)',
};

const footerStyle: React.CSSProperties = {
    marginTop: 'var(--space-8)',
    textAlign: 'center',
};

const footerTextStyle: React.CSSProperties = {
    fontSize: 'var(--text-base)',
    color: 'var(--color-text-secondary)',
};

const linkStyle: React.CSSProperties = {
    color: 'var(--color-primary)',
    textDecoration: 'none',
    fontWeight: 'var(--font-medium)',
};
