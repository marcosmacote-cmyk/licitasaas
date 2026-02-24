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
                        <Building2 size={32} color="#2563eb" />
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
    backgroundColor: '#f8fafc',
    padding: '24px',
};

const cardStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: '400px',
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
    padding: '40px',
    display: 'flex',
    flexDirection: 'column',
};

const headerStyle: React.CSSProperties = {
    textAlign: 'center',
    marginBottom: '32px',
};

const logoContainerStyle: React.CSSProperties = {
    width: '64px',
    height: '64px',
    backgroundColor: '#eff6ff',
    borderRadius: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 16px',
};

const titleStyle: React.CSSProperties = {
    fontSize: '1.875rem',
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: '8px',
};

const subtitleStyle: React.CSSProperties = {
    fontSize: '0.875rem',
    color: '#64748b',
};

const formStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
};

const inputGroupStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
};

const labelStyle: React.CSSProperties = {
    fontSize: '0.875rem',
    fontWeight: 500,
    color: '#334155',
};

const inputWrapperStyle: React.CSSProperties = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
};

const iconStyle: React.CSSProperties = {
    position: 'absolute',
    left: '12px',
    color: '#94a3b8',
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px 10px 40px',
    borderRadius: '8px',
    border: '1px solid #e2e8f0',
    fontSize: '0.875rem',
    outline: 'none',
    transition: 'border-color 0.2s',
};

const buttonStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '12px',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    marginTop: '8px',
};

const errorStyle: React.CSSProperties = {
    padding: '12px',
    backgroundColor: '#fef2f2',
    color: '#b91c1c',
    borderRadius: '8px',
    fontSize: '0.875rem',
    textAlign: 'center',
    border: '1px solid #fee2e2',
};

const footerStyle: React.CSSProperties = {
    marginTop: '32px',
    textAlign: 'center',
};

const footerTextStyle: React.CSSProperties = {
    fontSize: '0.875rem',
    color: '#64748b',
};

const linkStyle: React.CSSProperties = {
    color: '#2563eb',
    textDecoration: 'none',
    fontWeight: 500,
};
