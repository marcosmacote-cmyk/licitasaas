import { useState, useEffect } from 'react';
import { ShieldAlert, ShieldCheck, Copy, Loader2, KeyRound } from 'lucide-react';
import { API_BASE_URL } from '../../config';
import { useToast } from '../ui'; // Assuming there is a ToastProvider

export function SecuritySettings() {
    const toast = useToast();
    const [is2faEnabled, setIs2faEnabled] = useState(false);
    const [qrCodeData, setQrCodeData] = useState<{ qrCodeUrl: string; secret: string } | null>(null);
    const [setupCode, setSetupCode] = useState('');
    const [loading, setLoading] = useState(false);

    // Initial load will need user context
    const token = localStorage.getItem('token');
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    useEffect(() => {
        // Assume user object might have a sync flag eventually, for now we will rely on UI
        // If 2FA gets enabled on backend, we should update localStorage ideally, but it's okay for now.
    }, []);

    const startSetup = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/auth/2fa/setup`, { method: 'POST', headers });
            if (!res.ok) throw new Error('Falha ao iniciar configuração 2FA');
            const data = await res.json();
            setQrCodeData(data);
        } catch (error: any) {
            toast.error(error.message || 'Erro');
        } finally {
            setLoading(false);
        }
    };

    const confirmSetup = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/auth/2fa/enable`, { 
                method: 'POST', headers, body: JSON.stringify({ token: setupCode }) 
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Código inválido');
            
            setIs2faEnabled(true);
            setQrCodeData(null);
            toast.success('Autenticação em duas etapas ativada!');
        } catch (error: any) {
            toast.error(error.message || 'Erro');
        } finally {
            setLoading(false);
        }
    };

    const copySecret = () => {
        if (!qrCodeData) return;
        navigator.clipboard.writeText(qrCodeData.secret);
        toast.success('Código secreto copiado!');
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{ 
                padding: 'var(--space-4)', 
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-border)',
                background: is2faEnabled ? 'var(--color-success-bg)' : 'var(--color-bg-surface-hover)',
            }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
                    <div style={{
                        padding: '10px',
                        borderRadius: '50%',
                        background: is2faEnabled ? 'var(--color-success)' : 'var(--color-warning)',
                        color: 'white'
                    }}>
                        {is2faEnabled ? <ShieldCheck size={24} /> : <ShieldAlert size={24} />}
                    </div>
                    <div style={{ flex: 1 }}>
                        <h4 style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '4px' }}>
                            Autenticação em Duas Etapas (2FA)
                        </h4>
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 'var(--space-3)' }}>
                            O duplo fator de autenticação adiciona uma camada extra de segurança à sua conta exigindo um código gerado no seu celular (Google Authenticator, Authy, etc) no momento do login.
                        </p>

                        {!is2faEnabled && !qrCodeData && (
                            <button className="btn btn-primary" onClick={startSetup} disabled={loading} style={{ gap: '8px' }}>
                                {loading && <Loader2 size={16} className="spinner" />}
                                <KeyRound size={16} /> Configurar 2FA
                            </button>
                        )}

                        {is2faEnabled && (
                            <span style={{ 
                                display: 'inline-flex', padding: '4px 10px', 
                                background: 'white', border: '1px solid var(--color-success)', 
                                color: 'var(--color-success)', borderRadius: '12px', fontSize: '12px', fontWeight: 600 
                            }}>
                                Ativado
                            </span>
                        )}
                    </div>
                </div>

                {qrCodeData && !is2faEnabled && (
                    <div style={{ 
                        marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-border)',
                        animation: 'fadeIn 0.3s ease-out'
                    }}>
                        <h5 style={{ fontSize: 'var(--text-md)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>Configure o Autenticador</h5>
                        <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
                            <div style={{ background: 'white', padding: '10px', borderRadius: '8px', border: '1px solid var(--color-border)', width: 'fit-content' }}>
                                <img src={qrCodeData.qrCodeUrl} alt="QR Code 2FA" style={{ width: 140, height: 140 }} />
                            </div>
                            <div style={{ flex: 1, minWidth: '250px' }}>
                                <ol style={{ marginLeft: '1.2rem', marginBottom: 'var(--space-3)', color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
                                    <li>Abra seu aplicativo autenticador preferido (Authy, Google Auth).</li>
                                    <li>Escaneie o QR Code ao lado.</li>
                                    <li>Ou adicione manualmente a chave: 
                                        <div onClick={copySecret} style={{ 
                                            display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                                            padding: '8px 12px', background: 'var(--color-bg-base)', borderRadius: '4px', marginTop: '4px',
                                            border: '1px dashed var(--color-border)', fontFamily: 'monospace', color: 'var(--color-primary)'
                                        }}>
                                            {qrCodeData.secret} <Copy size={14} />
                                        </div>
                                    </li>
                                    <li style={{ marginTop: '8px' }}>Insira o código de 6 dígitos gerado:</li>
                                </ol>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <input 
                                        type="text" 
                                        value={setupCode} 
                                        onChange={(e) => setSetupCode(e.target.value.replace(/[^0-9]/g, '').substring(0, 6))}
                                        placeholder="000000"
                                        style={{ 
                                            width: '120px', padding: '10px', fontSize: '18px', letterSpacing: '4px',
                                            textAlign: 'center', borderRadius: '4px', border: '1px solid var(--color-border)'
                                        }}
                                    />
                                    <button className="btn btn-primary" onClick={confirmSetup} disabled={setupCode.length !== 6 || loading}>
                                        {loading ? <Loader2 size={16} className="spinner" /> : 'Confirmar'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
