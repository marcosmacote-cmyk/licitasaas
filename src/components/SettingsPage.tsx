import { useState, useEffect } from 'react';
import { Save, Bell, Shield, MessageSquare, Phone, Send, Loader2, Info } from 'lucide-react';
import { API_BASE_URL } from '../config';

export function SettingsPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState({
        keywords: 'suspensa,reaberta,vencedora',
        phoneNumber: '',
        telegramChatId: '',
        isActive: true
    });

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const token = localStorage.getItem('token');
                const res = await fetch(`${API_BASE_URL}/api/chat-monitor/config`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setConfig({
                        keywords: data.keywords || 'suspensa,reaberta,vencedora',
                        phoneNumber: data.phoneNumber || '',
                        telegramChatId: data.telegramChatId || '',
                        isActive: data.isActive ?? true
                    });
                }
            } catch (e) {
                console.error("Failed to fetch config", e);
            } finally {
                setLoading(false);
            }
        };
        fetchConfig();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/chat-monitor/config`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(config)
            });
            if (res.ok) {
                alert("Configurações salvas com sucesso!");
            } else {
                throw new Error("Erro ao salvar");
            }
        } catch (e) {
            console.error(e);
            alert("Falha ao salvar configurações.");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
                <Loader2 size={32} className="spinner" color="var(--color-primary)" />
            </div>
        );
    }

    return (
        <div className="page-container">
            <div className="page-header" style={{ marginBottom: '32px' }}>
                <h1 className="page-title">Configurações do Sistema</h1>
                <p className="page-subtitle">Gerencie suas preferências, notificações e o Monitor de Chat PNCP.</p>
            </div>

            <div style={{ maxWidth: '800px', display: 'grid', gap: '24px' }}>
                {/* Chat Monitor Config Card */}
                <div className="card" style={{ padding: '0', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                    <div style={{ padding: '20px 24px', background: 'var(--color-primary)', color: 'white', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <MessageSquare size={20} />
                        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>Monitor de Chat de Sessão (PNCP)</h2>
                    </div>
                    
                    <div style={{ padding: '28px' }}>
                        <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(37, 99, 235, 0.05)', borderRadius: '12px', border: '1px solid rgba(37, 99, 235, 0.1)' }}>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                                    <Bell size={20} />
                                </div>
                                <div>
                                    <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>Monitoramento Ativo</div>
                                    <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)' }}>Ativar radar automático para processos sinalizados no Kanban.</div>
                                </div>
                            </div>
                            <label className="switch">
                                <input 
                                    type="checkbox" 
                                    checked={config.isActive} 
                                    onChange={(e) => setConfig({...config, isActive: e.target.checked})}
                                />
                                <span className="slider round"></span>
                            </label>
                        </div>

                        <div style={{ display: 'grid', gap: '24px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-secondary)' }}>
                                    Palavras-chave de Alerta
                                </label>
                                <textarea 
                                    value={config.keywords}
                                    onChange={(e) => setConfig({...config, keywords: e.target.value})}
                                    placeholder="Ex: suspensa, reaberta, vencedora, Marcos, desclassificada"
                                    style={{ 
                                        width: '100%', 
                                        padding: '12px 16px', 
                                        borderRadius: '10px', 
                                        border: '1px solid var(--color-border)', 
                                        background: 'var(--color-bg-base)',
                                        minHeight: '80px',
                                        fontSize: '0.9375rem',
                                        lineHeight: '1.5',
                                        color: 'var(--color-text-primary)'
                                    }}
                                />
                                <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Info size={12} /> O radar soará um aviso sempre que estas palavras aparecerem no chat oficial da licitação.
                                </p>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                <div>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-secondary)' }}>
                                        <Phone size={16} color="var(--color-success)" /> WhatsApp para Avisos
                                    </label>
                                    <input 
                                        type="text"
                                        value={config.phoneNumber}
                                        onChange={(e) => setConfig({...config, phoneNumber: e.target.value})}
                                        placeholder="+55 (85) 99999-9999"
                                        style={{ 
                                            width: '100%', 
                                            padding: '12px 16px', 
                                            borderRadius: '10px', 
                                            border: '1px solid var(--color-border)', 
                                            background: 'var(--color-bg-base)',
                                            fontSize: '0.9375rem',
                                            color: 'var(--color-text-primary)'
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-secondary)' }}>
                                        <Send size={16} color="#0088cc" /> Telegram Chat ID
                                    </label>
                                    <input 
                                        type="text"
                                        value={config.telegramChatId}
                                        onChange={(e) => setConfig({...config, telegramChatId: e.target.value})}
                                        placeholder="Seu Chat ID (ou @usuario)"
                                        style={{ 
                                            width: '100%', 
                                            padding: '12px 16px', 
                                            borderRadius: '10px', 
                                            border: '1px solid var(--color-border)', 
                                            background: 'var(--color-bg-base)',
                                            fontSize: '0.9375rem',
                                            color: 'var(--color-text-primary)'
                                        }}
                                    />
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--color-border)', paddingTop: '24px' }}>
                            <button 
                                className="btn btn-primary" 
                                style={{ padding: '12px 28px', borderRadius: '12px', gap: '8px', fontWeight: 600 }}
                                onClick={handleSave}
                                disabled={saving}
                            >
                                {saving ? <Loader2 size={18} className="spinner" /> : <Save size={18} />}
                                Salvar Configurações
                            </button>
                        </div>
                    </div>
                </div>

                {/* Other settings placeholder */}
                <div className="card" style={{ padding: '24px', opacity: 0.6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--color-text-tertiary)' }}>
                        <Shield size={20} />
                        <span style={{ fontWeight: 600 }}>Segurança e Acesso</span>
                        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', padding: '2px 8px', background: 'var(--color-border)', borderRadius: '12px' }}>Em breve</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
