import { useState, useEffect, useRef } from 'react';
import { Database, UploadCloud, RefreshCw, Layers, MapPin, Calendar, CheckCircle2, AlertCircle, FileSpreadsheet, Zap, Shield, ShieldOff, Hash } from 'lucide-react';
import { CompositionEditor } from '../CompositionEditor';

interface EngDatabase {
    id: string;
    name: string;
    uf: string | null;
    version: string | null;
    type: string;
    payrollExemption: boolean;
    referenceMonth: number | null;
    referenceYear: number | null;
    itemCount: number;
    compositionCount: number;
}

export function EngineeringHub() {
    const [activeTab, setActiveTab] = useState<'oficiais' | 'propria'>('oficiais');
    const [bases, setBases] = useState<EngDatabase[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncingSeinfra, setSyncingSeinfra] = useState(false);
    const [syncingOrse, setSyncingOrse] = useState(false);
    const [syncingSicor, setSyncingSicor] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const propriaBase = bases.find(b => b.type === 'PROPRIA' || b.name === 'PROPRIA');
    const [propriaComps, setPropriaComps] = useState<any[]>([]);
    const [loadingPropria, setLoadingPropria] = useState(false);
    const [propriaSearch, setPropriaSearch] = useState('');
    const [editingComp, setEditingComp] = useState<any>(null);

    const loadPropria = async () => {
        if (!propriaBase) return;
        setLoadingPropria(true);
        try {
            const res = await fetch(`/api/engineering/compositions?databaseId=${propriaBase.id}&limit=500&q=${encodeURIComponent(propriaSearch)}`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
            if (res.ok) setPropriaComps(await res.json());
        } catch (e) {}
        setLoadingPropria(false);
    };

    useEffect(() => {
        if (activeTab === 'propria') loadPropria();
    }, [activeTab, propriaBase, propriaSearch]);

    const userStr = localStorage.getItem('user');
    const user = userStr ? JSON.parse(userStr) : null;
    const isAdmin = user?.role === 'ADMIN' || user?.role === 'admin' || user?.role === 'SUPER_ADMIN';

    const fetchBases = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/engineering/bases', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (res.ok) setBases(await res.json());
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBases();
    }, []);

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        let name = 'SINAPI';
        if (file.name.toUpperCase().includes('SEINFRA')) name = 'SEINFRA';
        if (file.name.toUpperCase().includes('SICRO')) name = 'SICRO';
        if (file.name.toUpperCase().includes('ORSE')) name = 'ORSE';
        if (file.name.toUpperCase().includes('SICOR')) name = 'SICOR';

        const ufMatch = file.name.match(/_([A-Z]{2})_/i) || file.name.match(/-([A-Z]{2})-/i);
        const uf = ufMatch ? ufMatch[1].toUpperCase() : '';

        const formData = new FormData();
        formData.append('file', file);
        formData.append('baseName', name);
        if (uf) formData.append('uf', uf);
        formData.append('version', new Date().toISOString().substring(0, 7));

        setUploading(true);
        setUploadProgress(10);
        
        const interval = setInterval(() => {
            setUploadProgress(p => p < 90 ? p + 5 : p);
        }, 500);

        try {
            const res = await fetch('/api/engineering/bases/import', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: formData
            });
            
            clearInterval(interval);
            setUploadProgress(100);
            
            if (res.ok) {
                alert('Base importada com sucesso!');
                fetchBases();
            } else {
                const err = await res.json();
                alert('Erro: ' + (err.error || 'Falha ao importar'));
            }
        } catch (err) {
            clearInterval(interval);
            alert('Erro de conexão ao importar');
        } finally {
            setUploading(false);
            setUploadProgress(0);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleSyncSinapi = async () => {
        if (!confirm('Iniciar download automático do SINAPI?\n\nIsso vai buscar as últimas 12 data-bases do Ceará (Onerado + Desonerado) diretamente do portal da Caixa.\n\nO processo roda em background e pode levar alguns minutos.')) return;
        
        setSyncing(true);
        try {
            const res = await fetch('/api/engineering/bases/sync-sinapi', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ufs: ['CE'], months: 12, includeDesonerado: true })
            });
            
            if (res.ok) {
                alert('Sync SINAPI iniciado em background!\n\nAcompanhe o progresso nos logs do servidor.\nRecarregue esta página em alguns minutos para ver as novas bases.');
                // Poll for updates
                setTimeout(fetchBases, 30000);
                setTimeout(fetchBases, 60000);
                setTimeout(fetchBases, 120000);
            } else {
                const err = await res.json();
                alert('Erro: ' + (err.error || 'Falha ao iniciar sync'));
            }
        } catch (err) {
            alert('Erro de conexão');
        } finally {
            setSyncing(false);
        }
    };

    const handleSyncSeinfra = async () => {
        if (!confirm('Importar SEINFRA-CE pelo SIPROCE?\n\nIsso vai separar a base onerada 028 da desonerada 028.1 para evitar falso alerta de preço.')) return;

        setSyncingSeinfra(true);
        try {
            const res = await fetch('/api/engineering/bases/scrape-seinfra', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ regime: 'ambas' })
            });

            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                const imported = (data.results || []).map((r: any) => `${r.version} ${r.payrollExemption ? 'Desonerado' : 'Onerado'}: ${r.inserted?.compositions || 0} composições`).join('\n');
                alert(`Sync SEINFRA concluído!\n\n${imported || data.message || ''}`);
                fetchBases();
            } else {
                alert('Erro: ' + (data.error || 'Falha ao importar SEINFRA'));
            }
        } catch (err) {
            alert('Erro de conexão ao importar SEINFRA');
        } finally {
            setSyncingSeinfra(false);
        }
    };

    const handleSyncOrse = async () => {
        if (!confirm('Sincronizar ORSE?\n\nIsso vai buscar os últimos 12 períodos disponíveis na consulta pública oficial da ORSE e gravar as composições para auditoria de preços. O processo roda em background e pode levar alguns minutos.')) return;

        setSyncingOrse(true);
        try {
            const res = await fetch('/api/engineering/bases/sync-orse', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ months: 12 })
            });

            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                alert(data.message || 'Sync ORSE iniciado em background. Acompanhe os logs e recarregue em alguns minutos.');
                setTimeout(fetchBases, 30000);
                setTimeout(fetchBases, 90000);
                setTimeout(fetchBases, 180000);
            } else {
                alert('Erro: ' + (data.error || 'Falha ao iniciar sync ORSE'));
            }
        } catch (err) {
            alert('Erro de conexão ao sincronizar ORSE');
        } finally {
            setSyncingOrse(false);
        }
    };

    const handleSyncSicor = async () => {
        if (!confirm('Sincronizar SICOR-MG?\n\nIsso vai buscar as últimas 12 datas-base oficiais do DER-MG, nos regimes com e sem desoneração. O processo roda em background e pode levar alguns minutos.')) return;

        setSyncingSicor(true);
        try {
            const res = await fetch('/api/engineering/bases/sync-sicor-mg', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    months: 12,
                    conditions: ['SD', 'CD'],
                    includeCompositionWorkbook: true,
                })
            });

            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                alert(data.message || 'Sync SICOR-MG iniciado em background. Acompanhe os logs e recarregue em alguns minutos.');
                setTimeout(fetchBases, 30000);
                setTimeout(fetchBases, 90000);
                setTimeout(fetchBases, 180000);
                setTimeout(fetchBases, 300000);
            } else if (res.status === 400 && String(data.error || '').includes('Token')) {
                // Backend doesn't have credentials configured — offer manual token
                const manualToken = window.prompt(
                    'Credenciais SICOR-MG não configuradas.\n\n' +
                    'Configure SICOR_MG_CNPJ e SICOR_MG_SENHA no Railway para login automático.\n\n' +
                    'Ou informe um Bearer token temporário (obtido via DevTools do portal DER-MG):'
                )?.trim() || '';
                if (!manualToken) {
                    alert('Sync cancelado. Configure as credenciais no Railway.');
                    return;
                }
                // Retry with manual token
                const retryRes = await fetch('/api/engineering/bases/sync-sicor-mg', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`,
                        'Content-Type': 'application/json',
                        'X-Sicor-Token': manualToken,
                    },
                    body: JSON.stringify({
                        months: 12,
                        conditions: ['SD', 'CD'],
                        includeCompositionWorkbook: true,
                        authToken: manualToken,
                    })
                });
                const retryData = await retryRes.json().catch(() => ({}));
                if (retryRes.ok) {
                    alert(retryData.message || 'Sync SICOR-MG iniciado com token manual.');
                    setTimeout(fetchBases, 30000);
                    setTimeout(fetchBases, 90000);
                } else {
                    alert('Erro: ' + (retryData.error || 'Token inválido'));
                }
            } else {
                const details = data.details ? `\n\nDetalhes: ${data.details}` : '';
                alert('Erro: ' + (data.error || 'Falha ao iniciar sync SICOR-MG') + details);
            }
        } catch (err) {
            alert('Erro de conexão ao sincronizar SICOR-MG');
        } finally {
            setSyncingSicor(false);
        }
    };

    // Group bases by name+uf for better visualization
    const groupedBases: Record<string, EngDatabase[]> = {};
    for (const base of bases) {
        const key = `${base.name}|${base.uf || 'Nacional'}`;
        if (!groupedBases[key]) groupedBases[key] = [];
        groupedBases[key].push(base);
    }
    // Sort within each group by year desc, month desc
    for (const key of Object.keys(groupedBases)) {
        groupedBases[key].sort((a, b) => {
            const yA = a.referenceYear || 0, yB = b.referenceYear || 0;
            if (yA !== yB) return yB - yA;
            const mA = a.referenceMonth || 0, mB = b.referenceMonth || 0;
            return mB - mA;
        });
    }

    const getBaseColor = (name: string) => {
        switch (name) {
            case 'SINAPI': return '#2563eb';
            case 'SEINFRA': return '#7c3aed';
            case 'ORSE': return '#0891b2';
            case 'SICRO': return '#dc2626';
            case 'SICOR': return '#ca8a04';
            default: return '#10b981';
        }
    };

    return (
        <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto', fontFamily: 'Inter, sans-serif' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
                <div>
                    <h2 style={{ margin: '0 0 4px', fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Database size={24} color="var(--color-primary)" /> Hub de Bases Oficiais
                    </h2>
                    <p style={{ margin: 0, color: 'var(--color-text-tertiary)', fontSize: '0.9rem' }}>
                        Catálogos oficiais do SINAPI, SEINFRA, SICOR-MG, ORSE e outros para uso automatizado nas propostas de engenharia.
                    </p>
                </div>

                {isAdmin && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button 
                            onClick={handleSyncSinapi}
                            disabled={syncing}
                            style={{ 
                                background: 'linear-gradient(135deg, #059669, #10b981)', color: '#fff', border: 'none', 
                                padding: '10px 18px', borderRadius: 'var(--radius-md)', fontWeight: 600, whiteSpace: 'nowrap',
                                display: 'flex', alignItems: 'center', gap: 8, cursor: syncing ? 'wait' : 'pointer',
                                opacity: syncing ? 0.7 : 1, transition: 'all 0.2s',
                                boxShadow: '0 4px 12px rgba(16,185,129,0.3)'
                            }}
                        >
                            {syncing ? <RefreshCw size={16} className="spin" /> : <Zap size={16} />}
                            {syncing ? 'Sincronizando...' : 'Sync SINAPI (Automático)'}
                        </button>

                        <button
                            onClick={handleSyncSeinfra}
                            disabled={syncingSeinfra}
                            style={{
                                background: 'linear-gradient(135deg, #7c3aed, #2563eb)', color: '#fff', border: 'none',
                                padding: '10px 18px', borderRadius: 'var(--radius-md)', fontWeight: 600, whiteSpace: 'nowrap',
                                display: 'flex', alignItems: 'center', gap: 8, cursor: syncingSeinfra ? 'wait' : 'pointer',
                                opacity: syncingSeinfra ? 0.7 : 1, transition: 'all 0.2s',
                                boxShadow: '0 4px 12px rgba(124,58,237,0.25)'
                            }}
                        >
                            {syncingSeinfra ? <RefreshCw size={16} className="spin" /> : <Database size={16} />}
                            {syncingSeinfra ? 'Importando...' : 'Sync SEINFRA'}
                        </button>

                        <button
                            onClick={handleSyncOrse}
                            disabled={syncingOrse}
                            style={{
                                background: 'linear-gradient(135deg, #0891b2, #06b6d4)', color: '#fff', border: 'none',
                                padding: '10px 18px', borderRadius: 'var(--radius-md)', fontWeight: 600, whiteSpace: 'nowrap',
                                display: 'flex', alignItems: 'center', gap: 8, cursor: syncingOrse ? 'wait' : 'pointer',
                                opacity: syncingOrse ? 0.7 : 1, transition: 'all 0.2s',
                                boxShadow: '0 4px 12px rgba(8,145,178,0.25)'
                            }}
                        >
                            {syncingOrse ? <RefreshCw size={16} className="spin" /> : <Database size={16} />}
                            {syncingOrse ? 'Sincronizando...' : 'Sync ORSE'}
                        </button>

                        <button
                            onClick={handleSyncSicor}
                            disabled={syncingSicor}
                            style={{
                                background: 'linear-gradient(135deg, #ca8a04, #f59e0b)', color: '#fff', border: 'none',
                                padding: '10px 18px', borderRadius: 'var(--radius-md)', fontWeight: 600, whiteSpace: 'nowrap',
                                display: 'flex', alignItems: 'center', gap: 8, cursor: syncingSicor ? 'wait' : 'pointer',
                                opacity: syncingSicor ? 0.7 : 1, transition: 'all 0.2s',
                                boxShadow: '0 4px 12px rgba(202,138,4,0.25)'
                            }}
                        >
                            {syncingSicor ? <RefreshCw size={16} className="spin" /> : <Database size={16} />}
                            {syncingSicor ? 'Sincronizando...' : 'Sync SICOR-MG'}
                        </button>

                        <div style={{ position: 'relative' }}>
                            <input type="file" ref={fileInputRef} onChange={handleUpload} accept=".xlsx,.xls,.csv" style={{ display: 'none' }} />
                            <button 
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                                style={{ 
                                    background: 'var(--color-primary)', color: '#fff', border: 'none', 
                                    padding: '10px 18px', borderRadius: 'var(--radius-md)', fontWeight: 600, whiteSpace: 'nowrap',
                                    display: 'flex', alignItems: 'center', gap: 8, cursor: uploading ? 'wait' : 'pointer',
                                    opacity: uploading ? 0.7 : 1, transition: 'all 0.2s',
                                    boxShadow: '0 4px 12px rgba(37,99,235,0.2)'
                                }}
                            >
                                {uploading ? <RefreshCw size={16} className="spin" /> : <UploadCloud size={16} />}
                                {uploading ? `Processando... ${uploadProgress}%` : 'Upload Manual'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--color-border)', marginBottom: 24 }}>
                <button 
                    onClick={() => setActiveTab('oficiais')}
                    style={{ 
                        background: 'none', border: 'none', padding: '0 0 12px 0', fontSize: '0.95rem', fontWeight: activeTab === 'oficiais' ? 700 : 500,
                        color: activeTab === 'oficiais' ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                        borderBottom: activeTab === 'oficiais' ? '3px solid var(--color-primary)' : '3px solid transparent',
                        cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 8
                    }}>
                    <Database size={16} /> Bases Oficiais
                </button>
                <button 
                    onClick={() => setActiveTab('propria')}
                    style={{ 
                        background: 'none', border: 'none', padding: '0 0 12px 0', fontSize: '0.95rem', fontWeight: activeTab === 'propria' ? 700 : 500,
                        color: activeTab === 'propria' ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                        borderBottom: activeTab === 'propria' ? '3px solid var(--color-primary)' : '3px solid transparent',
                        cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 8
                    }}>
                    <Layers size={16} /> Minha Base Própria
                </button>
            </div>

            {activeTab === 'oficiais' && (
                <>
                    {/* Stats bar */}
            {bases.length > 0 && (
                <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
                    <div style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 180 }}>
                        <Database size={20} color="var(--color-primary)" />
                        <div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>{bases.length}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>Bases Instaladas</div>
                        </div>
                    </div>
                    <div style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 180 }}>
                        <Hash size={20} color="#059669" />
                        <div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>{bases.reduce((sum, b) => sum + (b.itemCount || 0), 0).toLocaleString('pt-BR')}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>Insumos Totais</div>
                        </div>
                    </div>
                    <div style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 180 }}>
                        <Layers size={20} color="#7c3aed" />
                        <div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>{bases.reduce((sum, b) => sum + (b.compositionCount || 0), 0).toLocaleString('pt-BR')}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>Composições Totais</div>
                        </div>
                    </div>
                    <div style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 180 }}>
                        <Calendar size={20} color="#f59e0b" />
                        <div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>{Object.keys(groupedBases).length}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>Catálogos Distintos</div>
                        </div>
                    </div>
                </div>
            )}

            {loading && bases.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                    <RefreshCw size={24} className="spin" style={{ marginBottom: 12, opacity: 0.5 }} />
                    <p>Carregando bases instaladas...</p>
                </div>
            ) : bases.length === 0 ? (
                <div style={{ padding: 60, textAlign: 'center', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--color-border)' }}>
                    <FileSpreadsheet size={48} color="var(--color-text-tertiary)" style={{ margin: '0 auto 16px', opacity: 0.4 }} />
                    <h3 style={{ margin: '0 0 8px', color: 'var(--color-text-secondary)', fontWeight: 700 }}>Nenhuma base oficial instalada</h3>
                    <p style={{ margin: '0 0 20px', color: 'var(--color-text-tertiary)', fontSize: '0.9rem', maxWidth: 400, marginInline: 'auto' }}>
                        {isAdmin 
                            ? 'Use os botões de sincronização para baixar automaticamente as bases oficiais mais recentes.'
                            : 'Nossa equipe técnica ainda não instalou os catálogos oficiais para este ambiente.'}
                    </p>
                    {isAdmin && (
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                            <button onClick={handleSyncSinapi} disabled={syncing} style={{ background: 'linear-gradient(135deg, #059669, #10b981)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                <Zap size={16} /> Iniciar Download Automático SINAPI
                            </button>
                            <button onClick={handleSyncSeinfra} disabled={syncingSeinfra} style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                <Database size={16} /> Importar SEINFRA
                            </button>
                            <button onClick={handleSyncOrse} disabled={syncingOrse} style={{ background: 'linear-gradient(135deg, #0891b2, #06b6d4)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                <Database size={16} /> Sincronizar ORSE
                            </button>
                            <button onClick={handleSyncSicor} disabled={syncingSicor} style={{ background: 'linear-gradient(135deg, #ca8a04, #f59e0b)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                <Database size={16} /> Sincronizar SICOR-MG
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
                    {bases.map(base => {
                        const color = getBaseColor(base.name);
                        const hasPayrollRegime = ['SINAPI', 'SEINFRA', 'SICOR'].includes(base.name);
                        const regimeLabel = hasPayrollRegime ? (base.payrollExemption ? 'Desonerado' : 'Onerado') : 'Catálogo único';
                        const regimeColor = hasPayrollRegime ? (base.payrollExemption ? '#f59e0b' : '#059669') : '#64748b';
                        const versionLabel = base.referenceMonth && base.referenceYear 
                            ? `${String(base.referenceMonth).padStart(2, '0')}/${base.referenceYear}` 
                            : (base.version || 'N/I');
                        const hasData = (base.itemCount || 0) + (base.compositionCount || 0) > 0;
                        
                        return (
                            <div key={base.id} style={{ 
                                background: 'var(--color-bg-surface)', border: `1px solid ${color}30`, 
                                borderRadius: 'var(--radius-lg)', overflow: 'hidden',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.03)', transition: 'transform 0.2s',
                                cursor: 'default', borderLeft: `4px solid ${color}`
                            }} onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseLeave={e => e.currentTarget.style.transform = 'none'}>
                                <div style={{ padding: '14px 18px', background: `linear-gradient(135deg, ${color}08, ${color}02)` }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ background: `${color}15`, padding: 6, borderRadius: 6, color: color }}>
                                                <Layers size={18} />
                                            </div>
                                            <div>
                                                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>{base.name}</h4>
                                                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                                                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#fff', background: color, padding: '1px 6px', borderRadius: 4 }}>
                                                        {base.type}
                                                    </span>
                                                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: regimeColor, background: `${regimeColor}15`, padding: '1px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 2 }}>
                                                        {hasPayrollRegime ? (base.payrollExemption ? <ShieldOff size={10} /> : <Shield size={10} />) : <Database size={10} />}
                                                        {regimeLabel}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        {hasData ? <CheckCircle2 size={18} color="#059669" /> : <AlertCircle size={18} color="#f59e0b" />}
                                    </div>
                                </div>
                                <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-text-secondary)', fontSize: '0.82rem' }}>
                                            <MapPin size={13} color="var(--color-text-tertiary)" />
                                            {base.uf ? `Estado: ${base.uf}` : 'Nacional'}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-text-secondary)', fontSize: '0.82rem' }}>
                                            <Calendar size={13} color="var(--color-text-tertiary)" />
                                            Data-base: <strong>{versionLabel}</strong>
                                        </div>
                                    </div>
                                    {hasData && (
                                        <div style={{ display: 'flex', gap: 12, marginTop: 4, padding: '8px 10px', background: 'var(--color-bg-subtle, #f9fafb)', borderRadius: 'var(--radius-md)' }}>
                                            <div style={{ flex: 1, textAlign: 'center' }}>
                                                <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>{(base.itemCount || 0).toLocaleString('pt-BR')}</div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>Insumos</div>
                                            </div>
                                            <div style={{ width: 1, background: 'var(--color-border)' }} />
                                            <div style={{ flex: 1, textAlign: 'center' }}>
                                                <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>{(base.compositionCount || 0).toLocaleString('pt-BR')}</div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>Composições</div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            </>
            )}

            {activeTab === 'propria' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0, color: 'var(--color-text-primary)' }}>Minhas Composições Próprias</h3>
                        <div style={{ display: 'flex', gap: 12 }}>
                            <input 
                                placeholder="Buscar por código ou descrição..." 
                                value={propriaSearch} 
                                onChange={e => setPropriaSearch(e.target.value)}
                                style={{ padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', width: 300, background: 'var(--color-bg-surface)' }}
                            />
                            <button style={{ background: 'var(--color-primary)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: 'var(--radius-sm)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                                <Layers size={14} /> Nova Composição
                            </button>
                        </div>
                    </div>

                    {!propriaBase ? (
                        <div style={{ padding: 60, textAlign: 'center', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--color-border)' }}>
                            <Layers size={48} color="var(--color-text-tertiary)" style={{ margin: '0 auto 16px', opacity: 0.4 }} />
                            <h3 style={{ margin: '0 0 8px', color: 'var(--color-text-secondary)', fontWeight: 700 }}>Base Própria ainda não criada</h3>
                            <p style={{ margin: '0 0 20px', color: 'var(--color-text-tertiary)', fontSize: '0.9rem', maxWidth: 400, marginInline: 'auto' }}>
                                A base será criada automaticamente na primeira extração de edital via IA ou quando você criar a primeira composição.
                            </p>
                        </div>
                    ) : loadingPropria ? (
                        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                            <RefreshCw size={24} className="spin" style={{ marginBottom: 12, opacity: 0.5 }} />
                            <p>Carregando composições próprias...</p>
                        </div>
                    ) : propriaComps.length === 0 ? (
                        <div style={{ padding: 60, textAlign: 'center', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--color-border)' }}>
                            <Layers size={48} color="var(--color-text-tertiary)" style={{ margin: '0 auto 16px', opacity: 0.4 }} />
                            <h3 style={{ margin: '0 0 8px', color: 'var(--color-text-secondary)', fontWeight: 700 }}>Nenhuma composição encontrada</h3>
                        </div>
                    ) : (
                        <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                <thead>
                                    <tr style={{ background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                                        <th style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>Código</th>
                                        <th style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>Descrição</th>
                                        <th style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>Unidade</th>
                                        <th style={{ padding: '12px 16px', color: 'var(--color-text-secondary)', textAlign: 'right' }}>Itens</th>
                                        <th style={{ padding: '12px 16px', color: 'var(--color-text-secondary)', textAlign: 'right' }}>Custo (R$)</th>
                                        <th style={{ padding: '12px 16px', color: 'var(--color-text-secondary)', textAlign: 'center' }}>Ações</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {propriaComps.map(comp => (
                                        <tr key={comp.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-primary)' }}>{comp.code}</td>
                                            <td style={{ padding: '12px 16px', fontWeight: 500 }}>{comp.description}</td>
                                            <td style={{ padding: '12px 16px' }}>{comp.unit}</td>
                                            <td style={{ padding: '12px 16px', textAlign: 'right' }}>{comp._count?.items || 0}</td>
                                            <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700 }}>{comp.totalPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                            <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                                                <button onClick={() => setEditingComp({
                                                    id: comp.id, code: comp.code, description: comp.description, 
                                                    unit: comp.unit, quantity: 1, unitCost: comp.totalPrice, 
                                                    itemNumber: '1', sourceName: 'PROPRIA'
                                                })} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'white', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>Editar</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {editingComp && (
                <CompositionEditor 
                    items={[editingComp]} 
                    initialIndex={0} 
                    onClose={() => { setEditingComp(null); loadPropria(); }} 
                    onUpdateItem={() => {}} 
                />
            )}
        </div>
    );
}
