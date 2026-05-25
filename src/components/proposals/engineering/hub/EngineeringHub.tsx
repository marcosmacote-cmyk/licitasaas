import { useState, useEffect, useRef, useMemo } from 'react';
import { Database, UploadCloud, RefreshCw, Layers, MapPin, CheckCircle2, AlertCircle, FileSpreadsheet, Zap, Shield, ShieldOff, Hash, ChevronDown, ChevronUp, Search, X, Filter, Trash2, Edit3, Pencil, Package, Wrench, Sparkles } from 'lucide-react';
import { CompositionEditor } from '../CompositionEditor';
import { apiFetch } from '../../../../services/apiClient';

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

const SOURCE_COLORS: Record<string, string> = {
    SINAPI: '#059669', SEINFRA: '#7c3aed', ORSE: '#0891b2', SICOR: '#ca8a04', SICRO: '#dc2626', SBC: '#d97706', CAERN: '#0d9488', PROPRIA: '#2563eb',
};
const SOURCE_ORDER = ['SINAPI', 'SICRO', 'SBC', 'CAERN', 'SICOR', 'SEINFRA', 'ORSE', 'PROPRIA'];

export function EngineeringHub() {
    const [activeTab, setActiveTab] = useState<'oficiais' | 'propria'>('oficiais');
    const [bases, setBases] = useState<EngDatabase[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncingSeinfra, setSyncingSeinfra] = useState(false);
    const [syncingOrse, setSyncingOrse] = useState(false);
    const [syncingSicor, setSyncingSicor] = useState(false);
    const [syncingSicro, setSyncingSicro] = useState(false);
    const [syncingSbc, setSyncingSbc] = useState(false);
    const [syncingCaern, setSyncingCaern] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ── Filter state ──
    const [filterSources, setFilterSources] = useState<string[]>([]);
    const [filterStates, setFilterStates] = useState<string[]>([]);
    const [filterRegime, setFilterRegime] = useState<string[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

    // ── Hub global search ──
    const [hubSearchQuery, setHubSearchQuery] = useState('');
    const [hubSearchResults, setHubSearchResults] = useState<{ compositions: any[]; items: any[] } | null>(null);
    const [hubSearching, setHubSearching] = useState(false);
    const hubSearchTimer = useRef<any>(null);

    const propriaBase = bases.find(b => b.type === 'PROPRIA' || b.name === 'PROPRIA');
    const [propriaComps, setPropriaComps] = useState<any[]>([]);
    const [propriaItems, setPropriaItems] = useState<any[]>([]);
    const [loadingPropria, setLoadingPropria] = useState(false);
    const [propriaSearch, setPropriaSearch] = useState('');
    const [editingComp, setEditingComp] = useState<any>(null);
    const [propriaSubTab, setPropriaSubTab] = useState<'composicoes' | 'insumos'>('composicoes');
    const [cleaningUp, setCleaningUp] = useState(false);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [editItemData, setEditItemData] = useState<{code: string; description: string; unit: string; price: string; type: string}>({code:'', description:'', unit:'', price:'', type:''});
    const [editingHubCompId, setEditingHubCompId] = useState<string | null>(null);
    const [editHubCompData, setEditHubCompData] = useState<{code: string; description: string; unit: string}>({code:'', description:'', unit:''});

    const hdrs = () => ({ 'Authorization': `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' });

    const loadPropria = async () => {
        if (!propriaBase) return;
        setLoadingPropria(true);
        try {
            const [compsRes, itemsRes] = await Promise.all([
                fetch(`/api/engineering/compositions?databaseId=${propriaBase.id}&limit=500&q=${encodeURIComponent(propriaSearch)}`, { headers: hdrs() }),
                fetch(`/api/engineering/items?databaseId=${propriaBase.id}&limit=500&q=${encodeURIComponent(propriaSearch)}`, { headers: hdrs() }),
            ]);
            if (compsRes.ok) setPropriaComps(await compsRes.json());
            if (itemsRes.ok) setPropriaItems(await itemsRes.json());
        } catch (e) {}
        setLoadingPropria(false);
    };

    const deleteComp = async (id: string, code: string) => {
        if (!confirm(`Excluir composição "${code}" e todos os seus itens?`)) return;
        try {
            const res = await fetch(`/api/engineering/compositions/${id}`, { method: 'DELETE', headers: hdrs() });
            if (res.ok) { loadPropria(); } else { const e = await res.json(); alert(e.error || 'Erro ao excluir'); }
        } catch { alert('Erro de conexão'); }
    };

    const deleteItem = async (id: string, code: string) => {
        if (!confirm(`Excluir insumo "${code}"? Se estiver em composições, as referências serão removidas.`)) return;
        try {
            const res = await fetch(`/api/engineering/items/${id}`, { method: 'DELETE', headers: hdrs() });
            if (res.ok) { loadPropria(); } else { const e = await res.json(); alert(e.error || 'Erro ao excluir'); }
        } catch { alert('Erro de conexão'); }
    };

    const saveItemEdit = async (id: string) => {
        try {
            const res = await fetch(`/api/engineering/items/${id}`, { method: 'PUT', headers: hdrs(), body: JSON.stringify(editItemData) });
            if (res.ok) { setEditingItemId(null); loadPropria(); } else { const e = await res.json(); alert(e.error || 'Erro ao salvar'); }
        } catch { alert('Erro de conexão'); }
    };

    const saveCompEdit = async (id: string) => {
        try {
            const res = await fetch(`/api/engineering/compositions/${id}`, {
                method: 'PUT',
                headers: hdrs(),
                body: JSON.stringify({
                    composition: {
                        code: editHubCompData.code,
                        description: editHubCompData.description,
                        unit: editHubCompData.unit
                    }
                })
            });
            if (res.ok) {
                setEditingHubCompId(null);
                loadPropria();
            } else {
                const e = await res.json();
                alert(e.error || 'Erro ao salvar');
            }
        } catch {
            alert('Erro de conexão');
        }
    };

    const runCleanup = async () => {
        if (!confirm('Limpar base própria?\n\n• Composições vazias (sem insumos) serão removidas\n• Insumos órfãos (não usados em nenhuma composição) serão removidos\n\nEssa ação não pode ser desfeita.')) return;
        setCleaningUp(true);
        try {
            const res = await fetch('/api/engineering/propria/cleanup', { method: 'POST', headers: hdrs() });
            const data = await res.json();
            if (res.ok) {
                alert(`✅ ${data.message}\n\nRestantes: ${data.remaining.compositions} composições, ${data.remaining.items} insumos`);
                loadPropria();
            } else { alert(data.error || 'Erro'); }
        } catch { alert('Erro de conexão'); }
        setCleaningUp(false);
    };

    useEffect(() => {
        if (activeTab === 'propria') loadPropria();
    }, [activeTab, propriaBase, propriaSearch]);

    // Debounced hub search
    useEffect(() => {
        if (hubSearchTimer.current) clearTimeout(hubSearchTimer.current);
        if (hubSearchQuery.trim().length < 3) { setHubSearchResults(null); return; }
        setHubSearching(true);
        hubSearchTimer.current = setTimeout(async () => {
            try {
                const res = await fetch(`/api/engineering/hub/search?q=${encodeURIComponent(hubSearchQuery)}&limit=20`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
                if (res.ok) setHubSearchResults(await res.json());
            } catch (e) {}
            setHubSearching(false);
        }, 400);
        return () => { if (hubSearchTimer.current) clearTimeout(hubSearchTimer.current); };
    }, [hubSearchQuery]);

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

    const handleSyncSinapi = async (force = false) => {
        let body: any = { ufs: ['ALL'], months: 12, includeDesonerado: true, force };
        let confirmText = 'Iniciar download SINAPI Nacional?\n\n• Todos os 27 estados do Brasil\n• Últimos 12 meses\n• Onerado + Desonerado\n\nO processo roda em background via Puppeteer e pode levar ~30-60 minutos.\nBases já baixadas serão puladas automaticamente.';

        if (force) {
            const uf = (prompt('UF para reprocessar (ex: PA, CE, SP) ou ALL para todos os estados:', 'PA') || '').trim().toUpperCase();
            if (uf !== 'ALL' && !/^[A-Z]{2}$/.test(uf)) return alert('UF inválida.');
            const dataBase = (prompt('Data-base SINAPI para reprocessar (AAAA-MM):', '2025-10') || '').trim();
            const match = dataBase.match(/^(\d{4})-(\d{2})$/);
            if (!match) return alert('Data-base inválida. Use AAAA-MM.');
            const year = Number(match[1]);
            const month = Number(match[2]);
            if (month < 1 || month > 12 || year < 2009) return alert('Data-base inválida.');

            body = {
                ufs: uf === 'ALL' ? ['ALL'] : [uf],
                months: 1,
                includeDesonerado: true,
                force: true,
                targetPeriods: [{ month, year }]
            };
            confirmText = `Reprocessar SINAPI ${uf} ${dataBase}?\n\n• Onerado + Desonerado\n\nBases existentes ${uf === 'ALL' ? 'de todos os estados nessa data' : 'dessa UF/data'} serão reimportadas para reparar composições analíticas.`;
        }

        if (!confirm(confirmText)) return;
        
        setSyncing(true);
        try {
            await apiFetch('/api/engineering/bases/sync-sinapi', {
                method: 'POST',
                body: JSON.stringify(body)
            });

            alert(`Sync SINAPI iniciado em background${force ? ' (forçado)' : ''}!\n\nAcompanhe o progresso nos logs do servidor.\nRecarregue esta página em alguns minutos para ver as novas bases.`);
            // Poll for updates
            setTimeout(fetchBases, 30000);
            setTimeout(fetchBases, 60000);
            setTimeout(fetchBases, 120000);
        } catch (err: any) {
            if (err?.code === 'AUTH_EXPIRED') {
                alert('Sua sessão expirou. Faça login novamente e repita o reprocessamento SINAPI.');
                return;
            }
            alert('Erro: ' + (err?.message || 'Falha ao iniciar sync SINAPI'));
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

    // ── Brazilian state/region mapping ──
    const UF_NAMES: Record<string, string> = {
        AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia',
        CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
        MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso',
        PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná',
        RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima',
        RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo',
        TO: 'Tocantins',
    };
    const MACRO_REGIONS: Record<string, string[]> = {
        'Norte': ['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO'],
        'Nordeste': ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
        'Centro-Oeste': ['DF', 'GO', 'MS', 'MT'],
        'Sudeste': ['ES', 'MG', 'RJ', 'SP'],
        'Sul': ['PR', 'RS', 'SC'],
    };

    // Extract the 2-letter UF from raw uf field: "AC-RBO" → "AC", "MG-R1" → "MG", "Nacional" → "Nacional"
    const extractUF = (raw: string | null): string => {
        if (!raw) return 'Nacional';
        const uf = raw.substring(0, 2).toUpperCase();
        return UF_NAMES[uf] ? uf : 'Nacional';
    };

    // ── Filtered + Grouped bases ──
    const allStates = useMemo(() => [...new Set(bases.map(b => extractUF(b.uf)))].sort(), [bases]);
    const allSources = useMemo(() => [...new Set(bases.map(b => b.name))].sort((a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b)), [bases]);

    // Macro-regions present in bases
    const presentRegions = useMemo(() => {
        const stateSet = new Set(allStates);
        return Object.entries(MACRO_REGIONS).filter(([, ufs]) => ufs.some(uf => stateSet.has(uf)));
    }, [allStates]);

    const toggleFilter = (arr: string[], val: string, setter: (v: string[]) => void) => {
        setter(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]);
    };
    const hasFilters = filterSources.length > 0 || filterStates.length > 0 || filterRegime.length > 0 || searchQuery.trim().length > 0;

    const filteredBases = useMemo(() => {
        return bases.filter(b => {
            if (b.type === 'PROPRIA' || b.name === 'PROPRIA') return false;
            if (filterSources.length > 0 && !filterSources.includes(b.name)) return false;
            if (filterStates.length > 0 && !filterStates.includes(extractUF(b.uf))) return false;
            if (filterRegime.length > 0) {
                const regime = b.payrollExemption ? 'Desonerado' : 'Onerado';
                if (!filterRegime.includes(regime)) return false;
            }
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const uf = extractUF(b.uf);
                const searchable = `${b.name} ${b.uf || ''} ${uf} ${UF_NAMES[uf] || ''} ${b.version || ''} ${b.referenceMonth}/${b.referenceYear}`.toLowerCase();
                if (!searchable.includes(q)) return false;
            }
            return true;
        });
    }, [bases, filterSources, filterStates, filterRegime, searchQuery]);

    // Group by STATE (2-letter UF) instead of by source
    const stateGroups = useMemo(() => {
        const map: Record<string, EngDatabase[]> = {};
        for (const b of filteredBases) {
            const uf = extractUF(b.uf);
            if (!map[uf]) map[uf] = [];
            map[uf].push(b);
        }
        // Sort within each state: source order first, then date desc, then regime
        Object.values(map).forEach(group => group.sort((a, b) => {
            const sA = SOURCE_ORDER.indexOf(a.name);
            const sB = SOURCE_ORDER.indexOf(b.name);
            if (sA !== sB) return sA - sB;
            const dA = (a.referenceYear || 0) * 100 + (a.referenceMonth || 0);
            const dB = (b.referenceYear || 0) * 100 + (b.referenceMonth || 0);
            if (dB !== dA) return dB - dA;
            return (a.payrollExemption ? 1 : 0) - (b.payrollExemption ? 1 : 0);
        }));
        // Sort states: Nacional first, then alphabetical by UF
        const sorted = Object.entries(map).sort(([a], [b]) => {
            if (a === 'Nacional') return -1;
            if (b === 'Nacional') return 1;
            return a.localeCompare(b);
        });
        return sorted;
    }, [filteredBases]);

    // Legacy groups by source (kept for backward compat if needed)
    const groups = useMemo(() => {
        const map: Record<string, EngDatabase[]> = {};
        for (const b of filteredBases) {
            if (!map[b.name]) map[b.name] = [];
            map[b.name].push(b);
        }
        Object.values(map).forEach(group => group.sort((a, b) => {
            const dA = (a.referenceYear || 0) * 100 + (a.referenceMonth || 0);
            const dB = (b.referenceYear || 0) * 100 + (b.referenceMonth || 0);
            if (dB !== dA) return dB - dA;
            return (a.payrollExemption ? 1 : 0) - (b.payrollExemption ? 1 : 0);
        }));
        const sorted = Object.entries(map).sort(([a], [b]) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b));
        return sorted;
    }, [filteredBases]);

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
                            onClick={() => handleSyncSinapi()}
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
                            {syncing ? 'Sincronizando...' : 'Sync SINAPI (Nacional)'}
                        </button>

                        <button
                            onClick={() => handleSyncSinapi(true)}
                            disabled={syncing}
                            title="Reimporta bases existentes para reparar composições analíticas incompletas"
                            style={{
                                background: 'linear-gradient(135deg, #047857, #0d9488)', color: '#fff', border: 'none',
                                padding: '10px 18px', borderRadius: 'var(--radius-md)', fontWeight: 600, whiteSpace: 'nowrap',
                                display: 'flex', alignItems: 'center', gap: 8, cursor: syncing ? 'wait' : 'pointer',
                                opacity: syncing ? 0.7 : 1, transition: 'all 0.2s',
                                boxShadow: '0 4px 12px rgba(13,148,136,0.25)'
                            }}
                        >
                            {syncing ? <RefreshCw size={16} className="spin" /> : <RefreshCw size={16} />}
                            Reprocessar SINAPI
                        </button>

                        <button
                            onClick={async () => {
                                if (!confirm('Iniciar download SICRO (DNIT)?\n\n• Sistema de Custos Rodoviários\n• Todos os 27 estados\n• Últimos 12 meses\n\nO processo roda em background e pode levar ~30-60 minutos.\nBases já baixadas serão puladas.')) return;
                                setSyncingSicro(true);
                                try {
                                    const res = await fetch('/api/engineering/bases/sync-sicro', {
                                        method: 'POST',
                                        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ ufs: ['ALL'], months: 12 })
                                    });
                                    if (res.ok) { const d = await res.json(); alert('[OK] ' + d.message); }
                                    else { const e = await res.json().catch(() => ({})); alert('Erro: ' + (e.error || res.statusText)); }
                                } catch (err) { alert('Erro de conexão'); }
                                setSyncingSicro(false);
                            }}
                            disabled={syncingSicro}
                            style={{
                                background: 'linear-gradient(135deg, #dc2626, #f97316)', color: '#fff', border: 'none',
                                padding: '10px 18px', borderRadius: 'var(--radius-md)', fontWeight: 600, whiteSpace: 'nowrap',
                                display: 'flex', alignItems: 'center', gap: 8, cursor: syncingSicro ? 'wait' : 'pointer',
                                opacity: syncingSicro ? 0.7 : 1, transition: 'all 0.2s',
                                boxShadow: '0 4px 12px rgba(220,38,38,0.25)'
                            }}
                        >
                            {syncingSicro ? <RefreshCw size={16} className="spin" /> : <Zap size={16} />}
                            {syncingSicro ? 'Sincronizando...' : 'Sync SICRO (DNIT)'}
                        </button>

                        <button
                            onClick={async () => {
                                if (!confirm('Iniciar download SBC (Informativo SBC)?\n\n• Banco de Composições Analíticas\n• 30 regiões/praças do Brasil\n• Últimos 12 meses\n\nRequer credenciais SBC configuradas.\nO processo roda em background e pode levar ~30-60 min.')) return;
                                setSyncingSbc(true);
                                try {
                                    const res = await fetch('/api/engineering/bases/sync-sbc', {
                                        method: 'POST',
                                        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ regions: ['ALL'], months: 12 })
                                    });
                                    if (res.ok) { const d = await res.json(); alert('[OK] ' + d.message); }
                                    else { const e = await res.json().catch(() => ({})); alert('Erro: ' + (e.error || res.statusText)); }
                                } catch (err) { alert('Erro de conexão'); }
                                setSyncingSbc(false);
                            }}
                            disabled={syncingSbc}
                            style={{
                                background: 'linear-gradient(135deg, #d97706, #f59e0b)', color: '#fff', border: 'none',
                                padding: '10px 18px', borderRadius: 'var(--radius-md)', fontWeight: 600, whiteSpace: 'nowrap',
                                display: 'flex', alignItems: 'center', gap: 8, cursor: syncingSbc ? 'wait' : 'pointer',
                                opacity: syncingSbc ? 0.7 : 1, transition: 'all 0.2s',
                                boxShadow: '0 4px 12px rgba(217,119,6,0.25)'
                            }}
                        >
                            {syncingSbc ? <RefreshCw size={16} className="spin" /> : <Database size={16} />}
                            {syncingSbc ? 'Sincronizando...' : 'Sync SBC'}
                        </button>

                        <button
                            onClick={async () => {
                                if (!confirm('Iniciar download CAERN (RN)?\n\n• Tabela de Preços da CAERN\n• Rio Grande do Norte\n• Últimos 3 anos\n\nAcesso público — sem credenciais.\nO processo roda em background.')) return;
                                setSyncingCaern(true);
                                try {
                                    const res = await fetch('/api/engineering/bases/sync-caern', {
                                        method: 'POST',
                                        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' },
                                        body: JSON.stringify({})
                                    });
                                    if (res.ok) { const d = await res.json(); alert('[OK] ' + d.message); }
                                    else { const e = await res.json().catch(() => ({})); alert('Erro: ' + (e.error || res.statusText)); }
                                } catch (err) { alert('Erro de conexão'); }
                                setSyncingCaern(false);
                            }}
                            disabled={syncingCaern}
                            style={{
                                background: 'linear-gradient(135deg, #0d9488, #14b8a6)', color: '#fff', border: 'none',
                                padding: '10px 18px', borderRadius: 'var(--radius-md)', fontWeight: 600, whiteSpace: 'nowrap',
                                display: 'flex', alignItems: 'center', gap: 8, cursor: syncingCaern ? 'wait' : 'pointer',
                                opacity: syncingCaern ? 0.7 : 1, transition: 'all 0.2s',
                                boxShadow: '0 4px 12px rgba(13,148,136,0.25)'
                            }}
                        >
                            {syncingCaern ? <RefreshCw size={16} className="spin" /> : <Database size={16} />}
                            {syncingCaern ? 'Sincronizando...' : 'Sync CAERN (RN)'}
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

            {activeTab === 'oficiais' && (<>
                {/* Stats bar */}
                {bases.length > 0 && (
                    <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
                        {[
                            { icon: <Database size={20} color="var(--color-primary)" />, val: filteredBases.length, label: 'Bases Filtradas' },
                            { icon: <Hash size={20} color="#059669" />, val: filteredBases.reduce((s, b) => s + (b.itemCount || 0), 0).toLocaleString('pt-BR'), label: 'Insumos' },
                            { icon: <Layers size={20} color="#7c3aed" />, val: filteredBases.reduce((s, b) => s + (b.compositionCount || 0), 0).toLocaleString('pt-BR'), label: 'Composições' },
                            { icon: <MapPin size={20} color="#f59e0b" />, val: stateGroups.length, label: 'Estados' },
                        ].map((s, i) => (
                            <div key={i} style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 150 }}>
                                {s.icon}
                                <div>
                                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>{s.val}</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>{s.label}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Filter bar */}
                {bases.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20, padding: '14px 16px', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                        {/* Row 1: Sources + Regime + Search */}
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                            <Filter size={16} color="var(--color-text-tertiary)" />
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {allSources.filter(s => s !== 'PROPRIA').map(src => {
                                    const active = filterSources.includes(src);
                                    const c = SOURCE_COLORS[src] || '#64748b';
                                    return <button key={src} onClick={() => toggleFilter(filterSources, src, setFilterSources)} style={{ padding: '4px 12px', borderRadius: 20, border: active ? `2px solid ${c}` : '1px solid var(--color-border)', background: active ? `${c}18` : 'transparent', color: active ? c : 'var(--color-text-secondary)', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', transition: 'all 0.15s' }}>{src}</button>;
                                })}
                            </div>
                            <div style={{ width: 1, height: 24, background: 'var(--color-border)' }} />
                            {['Onerado', 'Desonerado'].map(r => {
                                const active = filterRegime.includes(r);
                                const ic = r === 'Desonerado' ? '#f59e0b' : '#059669';
                                return <button key={r} onClick={() => toggleFilter(filterRegime, r, setFilterRegime)} style={{ padding: '4px 10px', borderRadius: 20, border: active ? `2px solid ${ic}` : '1px solid var(--color-border)', background: active ? `${ic}15` : 'transparent', color: active ? ic : 'var(--color-text-secondary)', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>{r === 'Desonerado' ? <ShieldOff size={12} /> : <Shield size={12} />}{r}</button>;
                            })}
                            <div style={{ flex: 1 }} />
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--color-text-tertiary)' }} />
                                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Buscar base..." style={{ padding: '6px 10px 6px 30px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', width: 180, background: 'var(--color-bg-base)' }} />
                            </div>
                            {hasFilters && <button onClick={() => { setFilterSources([]); setFilterStates([]); setFilterRegime([]); setSearchQuery(''); }} style={{ padding: '4px 10px', borderRadius: 20, border: '1px solid #ef444460', background: '#ef444410', color: '#ef4444', fontWeight: 600, fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}><X size={12} />Limpar</button>}
                        </div>
                        {/* Row 2: States grouped by macro-region */}
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start', borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
                            <MapPin size={14} color="var(--color-text-tertiary)" style={{ marginTop: 4 }} />
                            {presentRegions.map(([region, ufs]) => {
                                const presentUfs = ufs.filter(uf => allStates.includes(uf));
                                if (presentUfs.length === 0) return null;
                                const regionActive = presentUfs.some(uf => filterStates.includes(uf));
                                return (
                                    <div key={region} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: regionActive ? 'var(--color-primary)' : 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{region}</span>
                                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                            {presentUfs.map(uf => {
                                                const active = filterStates.includes(uf);
                                                return <button key={uf} onClick={() => toggleFilter(filterStates, uf, setFilterStates)} style={{ padding: '3px 8px', borderRadius: 6, border: active ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', background: active ? 'rgba(37,99,235,0.1)' : 'transparent', color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)', fontWeight: 600, fontSize: '0.72rem', cursor: 'pointer', transition: 'all 0.15s', lineHeight: 1.2 }}>{uf}</button>;
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                            {allStates.includes('Nacional') && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Nacional</span>
                                    <button onClick={() => toggleFilter(filterStates, 'Nacional', setFilterStates)} style={{ padding: '3px 8px', borderRadius: 6, border: filterStates.includes('Nacional') ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', background: filterStates.includes('Nacional') ? 'rgba(37,99,235,0.1)' : 'transparent', color: filterStates.includes('Nacional') ? 'var(--color-primary)' : 'var(--color-text-secondary)', fontWeight: 600, fontSize: '0.72rem', cursor: 'pointer' }}>BR</button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Hub global search — compositions + items */}
                {bases.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                            <Search size={18} style={{ position: 'absolute', left: 14, color: 'var(--color-text-tertiary)', zIndex: 1 }} />
                            <input
                                value={hubSearchQuery}
                                onChange={e => setHubSearchQuery(e.target.value)}
                                placeholder="Buscar composições e insumos em todas as bases... (ex: CONCRETO, 96526)"
                                style={{ width: '100%', padding: '12px 14px 12px 42px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.92rem', background: 'var(--color-bg-surface)', transition: 'border-color 0.2s' }}
                                onFocus={e => e.currentTarget.style.borderColor = 'var(--color-primary)'}
                                onBlur={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
                            />
                            {hubSearchQuery && <button onClick={() => { setHubSearchQuery(''); setHubSearchResults(null); }} style={{ position: 'absolute', right: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', padding: 4 }}><X size={16} /></button>}
                        </div>

                        {hubSearching && <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-tertiary)' }}><RefreshCw size={16} className="spin" style={{ marginRight: 8 }} />Pesquisando...</div>}

                        {hubSearchResults && !hubSearching && (
                            <div style={{ marginTop: 8, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-surface)', maxHeight: 420, overflowY: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
                                {hubSearchResults.compositions.length === 0 && hubSearchResults.items.length === 0 ? (
                                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.88rem' }}>Nenhum resultado para "{hubSearchQuery}"</div>
                                ) : (<>
                                    {hubSearchResults.compositions.length > 0 && (
                                        <div>
                                            <div style={{ padding: '8px 16px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 1, background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)' }}>
                                                Composições ({hubSearchResults.compositions.length})
                                            </div>
                                            {hubSearchResults.compositions.map((c: any) => {
                                                const db = c.database;
                                                const color = SOURCE_COLORS[db?.name] || '#64748b';
                                                const ver = db?.referenceMonth && db?.referenceYear ? `${String(db.referenceMonth).padStart(2, '0')}/${db.referenceYear}` : '';
                                                return (
                                                    <div key={c.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12, transition: 'background 0.1s', cursor: 'default' }} onMouseEnter={e => e.currentTarget.style.background = `${color}06`} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                        <div style={{ minWidth: 80, fontWeight: 700, color, fontSize: '0.85rem' }}>{c.code}</div>
                                                        <div style={{ flex: 1 }}>
                                                            <div style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-text-primary)' }}>{c.description}</div>
                                                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: 2, display: 'flex', gap: 8 }}>
                                                                <span style={{ fontWeight: 600, color }}>{db?.name}</span>
                                                                <span>{db?.uf || 'Nacional'}</span>
                                                                {ver && <span>{ver}</span>}
                                                                <span>{db?.payrollExemption ? 'Desonerado' : 'Onerado'}</span>
                                                                <span>{c._count?.items || 0} itens</span>
                                                            </div>
                                                        </div>
                                                        <div style={{ textAlign: 'right', minWidth: 100 }}>
                                                            <div style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--color-text-primary)' }}>R$ {(c.totalPrice || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>{c.unit}</div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {hubSearchResults.items.length > 0 && (
                                        <div>
                                            <div style={{ padding: '8px 16px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 1, background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)' }}>
                                                Insumos ({hubSearchResults.items.length})
                                            </div>
                                            {hubSearchResults.items.map((it: any) => {
                                                const db = it.database;
                                                const color = SOURCE_COLORS[db?.name] || '#64748b';
                                                const ver = db?.referenceMonth && db?.referenceYear ? `${String(db.referenceMonth).padStart(2, '0')}/${db.referenceYear}` : '';
                                                return (
                                                    <div key={it.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12, transition: 'background 0.1s', cursor: 'default' }} onMouseEnter={e => e.currentTarget.style.background = `${color}06`} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                        <div style={{ minWidth: 80, fontWeight: 700, color: '#059669', fontSize: '0.85rem' }}>{it.code}</div>
                                                        <div style={{ flex: 1 }}>
                                                            <div style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-text-primary)' }}>{it.description}</div>
                                                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: 2, display: 'flex', gap: 8 }}>
                                                                <span style={{ fontWeight: 600, color }}>{db?.name}</span>
                                                                <span>{db?.uf || 'Nacional'}</span>
                                                                {ver && <span>{ver}</span>}
                                                                <span>{it.type}</span>
                                                            </div>
                                                        </div>
                                                        <div style={{ textAlign: 'right', minWidth: 100 }}>
                                                            <div style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--color-text-primary)' }}>R$ {(it.price || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>{it.unit}</div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </>)}
                            </div>
                        )}
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
                        <p style={{ margin: 0, color: 'var(--color-text-tertiary)', fontSize: '0.9rem' }}>{isAdmin ? 'Use os botões acima para sincronizar.' : 'Aguarde a equipe técnica instalar os catálogos.'}</p>
                    </div>
                ) : groups.length === 0 ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                        <Filter size={24} style={{ marginBottom: 8, opacity: 0.4 }} />
                        <p>Nenhuma base corresponde aos filtros selecionados.</p>
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
                        {stateGroups.map(([uf, items]) => {
                            const isOpen = expandedGroup === uf;
                            const totalItems = items.reduce((s, b) => s + (b.itemCount || 0), 0);
                            const totalComps = items.reduce((s, b) => s + (b.compositionCount || 0), 0);
                            const sources = [...new Set(items.map(b => b.name))];
                            const stateName = UF_NAMES[uf] || uf;
                            const primaryColor = SOURCE_COLORS[sources[0]] || '#64748b';
                            return (
                                <div key={uf} style={{ borderRadius: 'var(--radius-lg)', border: `1px solid var(--color-border)`, overflow: 'hidden', background: 'var(--color-bg-surface)', transition: 'all 0.2s', boxShadow: isOpen ? `0 4px 20px ${primaryColor}15` : '0 1px 4px rgba(0,0,0,0.04)', gridColumn: isOpen ? '1 / -1' : undefined }}>
                                    <button onClick={() => setExpandedGroup(isOpen ? null : uf)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: `linear-gradient(135deg, ${primaryColor}06, transparent)`, border: 'none', borderLeft: `4px solid ${primaryColor}`, cursor: 'pointer', transition: 'background 0.2s' }}>
                                        <div style={{ background: `${primaryColor}12`, padding: 8, borderRadius: 8, display: 'flex' }}><MapPin size={18} color={primaryColor} /></div>
                                        <div style={{ flex: 1, textAlign: 'left' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                                <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>{uf === 'Nacional' ? 'Nacional' : `${uf} — ${stateName}`}</span>
                                                {sources.map(src => <span key={src} style={{ fontSize: '0.65rem', fontWeight: 700, color: '#fff', background: SOURCE_COLORS[src] || '#64748b', padding: '1px 7px', borderRadius: 8 }}>{src}</span>)}
                                            </div>
                                            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                                {items.length} bases • {totalItems.toLocaleString('pt-BR')} insumos • {totalComps.toLocaleString('pt-BR')} composições
                                            </div>
                                        </div>
                                        {isOpen ? <ChevronUp size={18} color="var(--color-text-tertiary)" /> : <ChevronDown size={18} color="var(--color-text-tertiary)" />}
                                    </button>
                                    {isOpen && (
                                        <div style={{ borderTop: '1px solid var(--color-border)' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                                                <thead>
                                                    <tr style={{ background: 'var(--color-bg-base)' }}>
                                                        <th style={{ padding: '8px 14px', textAlign: 'left', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '0.76rem' }}>Fonte</th>
                                                        <th style={{ padding: '8px 14px', textAlign: 'left', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '0.76rem' }}>Região</th>
                                                        <th style={{ padding: '8px 14px', textAlign: 'left', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '0.76rem' }}>Data-base</th>
                                                        <th style={{ padding: '8px 14px', textAlign: 'left', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '0.76rem' }}>Regime</th>
                                                        <th style={{ padding: '8px 14px', textAlign: 'right', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '0.76rem' }}>Insumos</th>
                                                        <th style={{ padding: '8px 14px', textAlign: 'right', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '0.76rem' }}>Composições</th>
                                                        <th style={{ padding: '8px 6px', textAlign: 'center', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '0.76rem' }}>⬤</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {items.map((b, i) => {
                                                        const ver = b.referenceMonth && b.referenceYear ? `${String(b.referenceMonth).padStart(2, '0')}/${b.referenceYear}` : (b.version || 'N/I');
                                                        const hasData = (b.itemCount || 0) + (b.compositionCount || 0) > 0;
                                                        const regime = ['SINAPI', 'SEINFRA', 'SICOR'].includes(b.name) ? (b.payrollExemption ? 'Desonerado' : 'Onerado') : 'Único';
                                                        const regColor = b.payrollExemption ? '#f59e0b' : '#059669';
                                                        const srcColor = SOURCE_COLORS[b.name] || '#64748b';
                                                        return (
                                                            <tr key={b.id} style={{ borderBottom: '1px solid var(--color-border)', background: i % 2 === 0 ? 'transparent' : 'var(--color-bg-base)' }}>
                                                                <td style={{ padding: '8px 14px' }}><span style={{ fontWeight: 700, color: srcColor, fontSize: '0.8rem' }}>{b.name}</span></td>
                                                                <td style={{ padding: '8px 14px', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{b.uf || '—'}</td>
                                                                <td style={{ padding: '8px 14px' }}>{ver}</td>
                                                                <td style={{ padding: '8px 14px' }}>
                                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.74rem', fontWeight: 600, color: regColor, background: `${regColor}12`, padding: '2px 7px', borderRadius: 8 }}>
                                                                        {b.payrollExemption ? <ShieldOff size={10} /> : <Shield size={10} />}{regime}
                                                                    </span>
                                                                </td>
                                                                <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>{(b.itemCount || 0).toLocaleString('pt-BR')}</td>
                                                                <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>{(b.compositionCount || 0).toLocaleString('pt-BR')}</td>
                                                                <td style={{ padding: '8px 6px', textAlign: 'center' }}>{hasData ? <CheckCircle2 size={14} color="#059669" /> : <AlertCircle size={14} color="#f59e0b" />}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </>)}

            {activeTab === 'propria' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Header with stats and actions */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                        <div>
                            <h3 style={{ margin: '0 0 4px', color: 'var(--color-text-primary)', fontSize: '1.15rem', fontWeight: 800 }}>Minha Base Própria</h3>
                            <div style={{ display: 'flex', gap: 16, fontSize: '0.78rem', color: 'var(--color-text-tertiary)' }}>
                                <span><Layers size={12} style={{ verticalAlign: -1 }} /> <strong style={{ color: 'var(--color-primary)' }}>{propriaComps.length}</strong> composições</span>
                                <span><Package size={12} style={{ verticalAlign: -1 }} /> <strong style={{ color: '#059669' }}>{propriaItems.length}</strong> insumos</span>
                                {propriaItems.filter((i: any) => (i._count?.compositionRefs || 0) === 0).length > 0 && (
                                    <span style={{ color: '#f59e0b' }}><AlertCircle size={12} style={{ verticalAlign: -1 }} /> {propriaItems.filter((i: any) => (i._count?.compositionRefs || 0) === 0).length} órfãos</span>
                                )}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--color-text-tertiary)' }} />
                                <input 
                                    placeholder="Buscar por código ou descrição..." 
                                    value={propriaSearch} 
                                    onChange={e => setPropriaSearch(e.target.value)}
                                    style={{ padding: '8px 12px 8px 32px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', width: 260, background: 'var(--color-bg-surface)', fontSize: '0.85rem' }}
                                />
                            </div>
                            <button 
                                onClick={runCleanup} 
                                disabled={cleaningUp}
                                style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 'var(--radius-sm)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: cleaningUp ? 'wait' : 'pointer', fontSize: '0.82rem', opacity: cleaningUp ? 0.7 : 1 }}
                            >
                                {cleaningUp ? <RefreshCw size={13} className="spin" /> : <Sparkles size={13} />}
                                Limpar Base
                            </button>
                        </div>
                    </div>

                    {/* Sub-tabs: Composições | Insumos */}
                    <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--color-border)' }}>
                        {([['composicoes', 'Composições', Layers, propriaComps.length], ['insumos', 'Insumos', Package, propriaItems.length]] as const).map(([key, label, Icon, count]) => (
                            <button key={key} onClick={() => setPropriaSubTab(key as any)} style={{
                                background: 'none', border: 'none', padding: '10px 20px', fontSize: '0.88rem',
                                fontWeight: propriaSubTab === key ? 700 : 500,
                                color: propriaSubTab === key ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                                borderBottom: propriaSubTab === key ? '3px solid var(--color-primary)' : '3px solid transparent',
                                cursor: 'pointer', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6,
                                marginBottom: -2,
                            }}>
                                <Icon size={15} /> {label} <span style={{ fontSize: '0.72rem', background: propriaSubTab === key ? 'rgba(37,99,235,0.1)' : 'var(--color-bg-base)', padding: '1px 7px', borderRadius: 10, fontWeight: 700 }}>{count}</span>
                            </button>
                        ))}
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
                            <p>Carregando base própria...</p>
                        </div>
                    ) : propriaSubTab === 'composicoes' ? (
                        /* ═════ COMPOSIÇÕES TAB ═════ */
                        propriaComps.length === 0 ? (
                            <div style={{ padding: 60, textAlign: 'center', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--color-border)' }}>
                                <Layers size={48} color="var(--color-text-tertiary)" style={{ margin: '0 auto 16px', opacity: 0.4 }} />
                                <h3 style={{ margin: '0 0 8px', color: 'var(--color-text-secondary)', fontWeight: 700 }}>Nenhuma composição encontrada</h3>
                            </div>
                        ) : (
                            <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                    <thead>
                                        <tr style={{ background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                                            <th style={{ padding: '10px 14px', color: 'var(--color-text-secondary)', fontSize: '0.76rem' }}>Código</th>
                                            <th style={{ padding: '10px 14px', color: 'var(--color-text-secondary)', fontSize: '0.76rem' }}>Descrição</th>
                                            <th style={{ padding: '10px 14px', color: 'var(--color-text-secondary)', fontSize: '0.76rem' }}>Unidade</th>
                                            <th style={{ padding: '10px 14px', color: 'var(--color-text-secondary)', fontSize: '0.76rem', textAlign: 'right' }}>Insumos</th>
                                            <th style={{ padding: '10px 14px', color: 'var(--color-text-secondary)', fontSize: '0.76rem', textAlign: 'right' }}>Custo (R$)</th>
                                            <th style={{ padding: '10px 14px', color: 'var(--color-text-secondary)', fontSize: '0.76rem', textAlign: 'center' }}>Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {propriaComps.map((comp, idx) => {
                                            const itemCount = comp._count?.items || 0;
                                            const isEditing = editingHubCompId === comp.id;
                                            return (
                                                <tr key={comp.id} style={{ borderBottom: '1px solid var(--color-border)', background: idx % 2 === 0 ? 'transparent' : 'var(--color-bg-base)' }}>
                                                    <td style={{ padding: '10px 14px' }}>
                                                        {isEditing ? (
                                                            <input value={editHubCompData.code} onChange={e => setEditHubCompData(d => ({...d, code: e.target.value}))} style={{ width: 80, padding: '3px 6px', border: '1px solid var(--color-primary)', borderRadius: 4, fontSize: '0.8rem', fontWeight: 700 }} />
                                                        ) : (
                                                            <span style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: '0.82rem' }}>{comp.code}</span>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '10px 14px' }}>
                                                        {isEditing ? (
                                                            <input value={editHubCompData.description} onChange={e => setEditHubCompData(d => ({...d, description: e.target.value}))} style={{ width: '100%', padding: '3px 6px', border: '1px solid var(--color-primary)', borderRadius: 4, fontSize: '0.8rem' }} />
                                                        ) : (
                                                            <span style={{ fontWeight: 500, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{comp.description}</span>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '10px 14px', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                                                        {isEditing ? (
                                                            <input value={editHubCompData.unit} onChange={e => setEditHubCompData(d => ({...d, unit: e.target.value}))} style={{ width: 45, padding: '3px 6px', border: '1px solid var(--color-primary)', borderRadius: 4, fontSize: '0.8rem' }} />
                                                        ) : (
                                                            comp.unit
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700, background: itemCount === 0 ? '#f59e0b15' : '#05966910', color: itemCount === 0 ? '#f59e0b' : '#059669' }}>
                                                            {itemCount === 0 && <AlertCircle size={11} />}
                                                            {itemCount}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontSize: '0.85rem' }}>{comp.totalPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                                                        {isEditing ? (
                                                            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                                                <button onClick={() => saveCompEdit(comp.id)} style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid #059669', background: '#05966910', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700, color: '#059669' }}>Salvar</button>
                                                                <button onClick={() => setEditingHubCompId(null)} style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'white', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>✕</button>
                                                            </div>
                                                        ) : (
                                                            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                                                <button onClick={() => { setEditingHubCompId(comp.id); setEditHubCompData({ code: comp.code, description: comp.description, unit: comp.unit }); }} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'white', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                    <Pencil size={11} /> Renomear
                                                                </button>
                                                                <button onClick={() => setEditingComp({
                                                                    id: comp.id, code: comp.code, description: comp.description, 
                                                                    unit: comp.unit, quantity: 1, unitCost: comp.totalPrice, 
                                                                    itemNumber: '1', sourceName: 'PROPRIA'
                                                                })} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'white', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                    <Layers size={11} /> Itens
                                                                </button>
                                                                <button onClick={() => deleteComp(comp.id, comp.code)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ef444440', background: '#ef44440a', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                    <Trash2 size={11} />
                                                                </button>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )
                    ) : (
                        /* ═════ INSUMOS TAB ═════ */
                        propriaItems.length === 0 ? (
                            <div style={{ padding: 60, textAlign: 'center', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--color-border)' }}>
                                <Package size={48} color="var(--color-text-tertiary)" style={{ margin: '0 auto 16px', opacity: 0.4 }} />
                                <h3 style={{ margin: '0 0 8px', color: 'var(--color-text-secondary)', fontWeight: 700 }}>Nenhum insumo próprio encontrado</h3>
                            </div>
                        ) : (
                            <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                    <thead>
                                        <tr style={{ background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                                            <th style={{ padding: '10px 14px', color: 'var(--color-text-secondary)', fontSize: '0.76rem' }}>Código</th>
                                            <th style={{ padding: '10px 14px', color: 'var(--color-text-secondary)', fontSize: '0.76rem' }}>Descrição</th>
                                            <th style={{ padding: '10px 14px', color: 'var(--color-text-secondary)', fontSize: '0.76rem' }}>Unidade</th>
                                            <th style={{ padding: '10px 14px', color: 'var(--color-text-secondary)', fontSize: '0.76rem' }}>Tipo</th>
                                            <th style={{ padding: '10px 14px', color: 'var(--color-text-secondary)', fontSize: '0.76rem', textAlign: 'right' }}>Preço (R$)</th>
                                            <th style={{ padding: '10px 14px', color: 'var(--color-text-secondary)', fontSize: '0.76rem', textAlign: 'right' }}>Usado em</th>
                                            <th style={{ padding: '10px 14px', color: 'var(--color-text-secondary)', fontSize: '0.76rem', textAlign: 'center' }}>Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {propriaItems.map((item: any, idx: number) => {
                                            const refs = item._count?.compositionRefs || 0;
                                            const isOrphan = refs === 0;
                                            const isEditing = editingItemId === item.id;
                                            const typeColors: Record<string, string> = { MATERIAL: '#059669', MAO_DE_OBRA: '#2563eb', EQUIPAMENTO: '#f59e0b', SERVICO: '#7c3aed', OBSERVACAO: '#94a3b8' };
                                            const typeLabels: Record<string, string> = { MATERIAL: 'Material', MAO_DE_OBRA: 'Mão de Obra', EQUIPAMENTO: 'Equipamento', SERVICO: 'Serviço', OBSERVACAO: 'Observação' };
                                            return (
                                                <tr key={item.id} style={{ borderBottom: '1px solid var(--color-border)', background: isOrphan ? '#f59e0b06' : idx % 2 === 0 ? 'transparent' : 'var(--color-bg-base)' }}>
                                                    <td style={{ padding: '8px 14px' }}>
                                                        {isEditing ? (
                                                            <input value={editItemData.code} onChange={e => setEditItemData(d => ({...d, code: e.target.value}))} style={{ width: 80, padding: '3px 6px', border: '1px solid var(--color-primary)', borderRadius: 4, fontSize: '0.8rem', fontWeight: 700 }} />
                                                        ) : (
                                                            <span style={{ fontWeight: 700, color: '#059669', fontSize: '0.82rem' }}>{item.code}</span>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '8px 14px' }}>
                                                        {isEditing ? (
                                                            <input value={editItemData.description} onChange={e => setEditItemData(d => ({...d, description: e.target.value}))} style={{ width: '100%', padding: '3px 6px', border: '1px solid var(--color-primary)', borderRadius: 4, fontSize: '0.8rem' }} />
                                                        ) : (
                                                            <span style={{ fontWeight: 500, maxWidth: 350, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{item.description}</span>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '8px 14px', fontSize: '0.8rem' }}>
                                                        {isEditing ? (
                                                            <input value={editItemData.unit} onChange={e => setEditItemData(d => ({...d, unit: e.target.value}))} style={{ width: 45, padding: '3px 6px', border: '1px solid var(--color-primary)', borderRadius: 4, fontSize: '0.8rem' }} />
                                                        ) : item.unit}
                                                    </td>
                                                    <td style={{ padding: '8px 14px' }}>
                                                        {isEditing ? (
                                                            <select value={editItemData.type} onChange={e => setEditItemData(d => ({...d, type: e.target.value}))} style={{ padding: '3px 4px', border: '1px solid var(--color-primary)', borderRadius: 4, fontSize: '0.75rem' }}>
                                                                {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                                            </select>
                                                        ) : (
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.72rem', fontWeight: 600, color: typeColors[item.type] || '#64748b', background: `${typeColors[item.type] || '#64748b'}12`, padding: '2px 7px', borderRadius: 8 }}>
                                                                {typeLabels[item.type] || item.type}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 700, fontSize: '0.85rem' }}>
                                                        {isEditing ? (
                                                            <input value={editItemData.price} onChange={e => setEditItemData(d => ({...d, price: e.target.value}))} style={{ width: 80, padding: '3px 6px', border: '1px solid var(--color-primary)', borderRadius: 4, fontSize: '0.8rem', textAlign: 'right' }} />
                                                        ) : (item.price || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                    </td>
                                                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700, background: isOrphan ? '#f59e0b15' : '#05966910', color: isOrphan ? '#f59e0b' : '#059669' }}>
                                                            {isOrphan && <AlertCircle size={11} />}
                                                            {refs} comp{refs !== 1 ? 's' : ''}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                                                        <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                                            {isEditing ? (<>
                                                                <button onClick={() => saveItemEdit(item.id)} style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid #059669', background: '#05966910', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700, color: '#059669' }}>Salvar</button>
                                                                <button onClick={() => setEditingItemId(null)} style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'white', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>✕</button>
                                                            </>) : (<>
                                                                <button onClick={() => { setEditingItemId(item.id); setEditItemData({ code: item.code, description: item.description, unit: item.unit, price: String(item.price || 0), type: item.type }); }} style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'white', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                                                                    <Edit3 size={10} /> Editar
                                                                </button>
                                                                <button onClick={() => deleteItem(item.id, item.code)} style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid #ef444440', background: '#ef44440a', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 3 }}>
                                                                    <Trash2 size={10} />
                                                                </button>
                                                            </>)}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )
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
