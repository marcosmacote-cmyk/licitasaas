import { useState, useEffect, useRef } from 'react';
import { Database, UploadCloud, RefreshCw, Layers, MapPin, Calendar, CheckCircle2, AlertCircle, FileSpreadsheet } from 'lucide-react';

interface EngDatabase {
    id: string;
    name: string;
    uf: string | null;
    version: string | null;
    type: string;
}

export function EngineeringHub() {
    const [bases, setBases] = useState<EngDatabase[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

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

        // Extract base info from filename intuitively
        let name = 'SINAPI';
        if (file.name.toUpperCase().includes('SEINFRA')) name = 'SEINFRA';
        if (file.name.toUpperCase().includes('SICRO')) name = 'SICRO';
        if (file.name.toUpperCase().includes('ORSE')) name = 'ORSE';

        // Extract UF (CE, SP, etc)
        const ufMatch = file.name.match(/_([A-Z]{2})_/i) || file.name.match(/-([A-Z]{2})-/i);
        const uf = ufMatch ? ufMatch[1].toUpperCase() : '';

        const formData = new FormData();
        formData.append('file', file);
        formData.append('baseName', name);
        if (uf) formData.append('uf', uf);
        formData.append('version', new Date().toISOString().substring(0, 7)); // default to current month

        setUploading(true);
        setUploadProgress(10);
        
        // Simulating progress for UX since native fetch doesn't support upload progress easily without XHR
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

    return (
        <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto', fontFamily: 'Inter, sans-serif' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                    <h2 style={{ margin: '0 0 4px', fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Database size={24} color="var(--color-primary)" /> Hub de Bases Oficiais
                    </h2>
                    <p style={{ margin: 0, color: 'var(--color-text-tertiary)', fontSize: '0.9rem' }}>
                        Gerencie os catálogos oficiais do SINAPI, SEINFRA e outros para uso automatizado nas propostas.
                    </p>
                </div>

                <div style={{ position: 'relative' }}>
                    <input type="file" ref={fileInputRef} onChange={handleUpload} accept=".xlsx,.xls,.csv" style={{ display: 'none' }} />
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        style={{ 
                            background: 'var(--color-primary)', color: '#fff', border: 'none', 
                            padding: '10px 18px', borderRadius: 'var(--radius-md)', fontWeight: 600, 
                            display: 'flex', alignItems: 'center', gap: 8, cursor: uploading ? 'wait' : 'pointer',
                            opacity: uploading ? 0.7 : 1, transition: 'all 0.2s',
                            boxShadow: '0 4px 12px rgba(37,99,235,0.2)'
                        }}
                    >
                        {uploading ? <RefreshCw size={16} className="spin" /> : <UploadCloud size={16} />}
                        {uploading ? `Processando... ${uploadProgress}%` : 'Importar Planilha Oficial'}
                    </button>
                </div>
            </div>

            {loading && bases.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                    <RefreshCw size={24} className="spin" style={{ marginBottom: 12, opacity: 0.5 }} />
                    <p>Carregando bases instaladas...</p>
                </div>
            ) : bases.length === 0 ? (
                <div style={{ padding: 60, textAlign: 'center', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--color-border)' }}>
                    <FileSpreadsheet size={48} color="var(--color-text-tertiary)" style={{ margin: '0 auto 16px', opacity: 0.4 }} />
                    <h3 style={{ margin: '0 0 8px', color: 'var(--color-text-secondary)', fontWeight: 700 }}>Nenhuma base importada</h3>
                    <p style={{ margin: '0 0 20px', color: 'var(--color-text-tertiary)', fontSize: '0.9rem', maxWidth: 400, marginInline: 'auto' }}>
                        Importe as planilhas analíticas da Caixa (SINAPI) ou estaduais para que o motor de Inteligência Artificial detalhe as composições automaticamente.
                    </p>
                    <button onClick={() => fileInputRef.current?.click()} style={{ background: 'transparent', color: 'var(--color-primary)', border: '1px solid var(--color-primary)', padding: '8px 16px', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer' }}>
                        Escolher Arquivo .xlsx
                    </button>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
                    {bases.map(base => {
                        const isPropria = base.type === 'PROPRIA';
                        const color = isPropria ? '#10b981' : (base.name === 'SINAPI' ? '#2563eb' : '#7c3aed');
                        
                        return (
                            <div key={base.id} style={{ 
                                background: 'var(--color-bg-surface)', border: `1px solid ${color}30`, 
                                borderRadius: 'var(--radius-lg)', overflow: 'hidden',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.03)', transition: 'transform 0.2s',
                                cursor: 'default'
                            }} onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseLeave={e => e.currentTarget.style.transform = 'none'}>
                                <div style={{ padding: '16px 20px', borderBottom: `1px solid ${color}15`, background: `linear-gradient(135deg, ${color}08, ${color}02)` }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ background: `${color}15`, padding: 6, borderRadius: 6, color: color }}>
                                                <Layers size={18} />
                                            </div>
                                            <div>
                                                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>{base.name}</h4>
                                                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: color, background: `${color}10`, padding: '2px 6px', borderRadius: 4 }}>
                                                    {base.type}
                                                </span>
                                            </div>
                                        </div>
                                        {isPropria ? <CheckCircle2 size={18} color="#10b981" /> : <CheckCircle2 size={18} color={color} />}
                                    </div>
                                </div>
                                <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
                                            <MapPin size={14} color="var(--color-text-tertiary)" />
                                            {base.uf ? `Estado: ${base.uf}` : 'Nacional'}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
                                            <Calendar size={14} color="var(--color-text-tertiary)" />
                                            Data-base / Versão: <strong>{base.version || 'Não informada'}</strong>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
