import { useState, useEffect, useCallback } from 'react';
import { Calculator, Plus, Save, Trash2, Cpu, TableProperties, Download, Search, X, Loader2, Layers, BarChart3, Calendar, Package } from 'lucide-react';
import { calculateBdiTCU, applyBdi, DEFAULT_BDI_CONFIG, TCU_REFERENCE_RANGES, type BdiConfig, type BdiTcuParams } from './bdiEngine';
import { CompositionDrawer } from './CompositionDrawer';
import { CurvaAbcPanel } from './CurvaAbcPanel';
import { CronogramaPanel } from './CronogramaPanel';
import { InsumoHub } from './InsumoHub';

interface EngItem {
    id: string; itemNumber: string; code: string; sourceName: string;
    description: string; unit: string; quantity: number;
    unitCost: number; unitPrice: number; totalPrice: number;
}

interface Props { proposalId: string; biddingId: string; }

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const token = () => localStorage.getItem('token') || '';
const hdrs = () => ({ 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' });

export function EngineeringProposalEditor({ proposalId, biddingId }: Props) {
    const [items, setItems] = useState<EngItem[]>([]);
    const [bdiConfig, setBdiConfig] = useState<BdiConfig>({ ...DEFAULT_BDI_CONFIG });
    const [isSaving, setIsSaving] = useState(false);
    const [isExtracting, setIsExtracting] = useState(false);
    const [saveMsg, setSaveMsg] = useState('');

    // Search modal
    const [showSearch, setShowSearch] = useState(false);
    const [bases, setBases] = useState<any[]>([]);
    const [selectedBaseId, setSelectedBaseId] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    // Composition drawer
    const [compositionItem, setCompositionItem] = useState<EngItem | null>(null);

    // Active tab
    const [activeTab, setActiveTab] = useState<'planilha' | 'hub_insumos' | 'curva_abc' | 'cronograma'>('planilha');

    const effectiveBdi = bdiConfig.mode === 'TCU' ? calculateBdiTCU(bdiConfig.tcu) : bdiConfig.bdiGlobal;
    const subtotal = items.reduce((s, it) => s + it.quantity * it.unitCost, 0);
    const total = items.reduce((s, it) => s + it.totalPrice, 0);

    // Recalculate all prices when BDI changes
    const recalcAll = useCallback((its: EngItem[], bdi: number) => {
        return its.map(it => {
            const up = applyBdi(it.unitCost, bdi);
            return { ...it, unitPrice: up, totalPrice: Math.round(it.quantity * up * 100) / 100 };
        });
    }, []);

    useEffect(() => { setItems(prev => recalcAll(prev, effectiveBdi)); }, [effectiveBdi]);

    // Load items on mount
    useEffect(() => {
        fetch(`/api/engineering/proposals/${proposalId}/items`, { headers: hdrs() })
            .then(r => r.json()).then(data => {
                if (Array.isArray(data) && data.length > 0) setItems(data);
            }).catch(console.error);

        fetch('/api/engineering/bases', { headers: hdrs() })
            .then(r => r.json()).then(data => {
                if (Array.isArray(data)) { setBases(data); if (data.length > 0) setSelectedBaseId(data[0].id); }
            }).catch(console.error);
    }, [proposalId]);

    // Save all items
    const handleSave = async () => {
        setIsSaving(true); setSaveMsg('');
        try {
            const res = await fetch(`/api/engineering/proposals/${proposalId}/items`, {
                method: 'POST', headers: hdrs(),
                body: JSON.stringify({ items, bdiConfig })
            });
            if (res.ok) { const d = await res.json(); setSaveMsg(`✅ ${d.message}`); }
            else { setSaveMsg('❌ Erro ao salvar'); }
        } catch { setSaveMsg('❌ Erro de rede'); }
        finally { setIsSaving(false); setTimeout(() => setSaveMsg(''), 4000); }
    };

    // AI extraction
    const handleExtractAI = async () => {
        setIsExtracting(true);
        try {
            const res = await fetch('/api/engineering/ai-populate', {
                method: 'POST', headers: hdrs(), body: JSON.stringify({ biddingId })
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro');
            const data = await res.json();
            if (data.items?.length > 0) {
                const mapped = data.items.map((ai: any, i: number) => ({
                    id: `ai-${Date.now()}-${i}`, itemNumber: ai.item || String(items.length + i + 1),
                    code: ai.code || 'N/A', sourceName: ai.sourceName || 'PROPRIA',
                    description: ai.description || '', unit: ai.unit || 'UN',
                    quantity: Number(ai.quantity) || 1, unitCost: Number(ai.unitCost) || 0,
                    unitPrice: applyBdi(Number(ai.unitCost) || 0, effectiveBdi),
                    totalPrice: Math.round((Number(ai.quantity) || 1) * applyBdi(Number(ai.unitCost) || 0, effectiveBdi) * 100) / 100,
                }));
                setItems(prev => [...prev, ...mapped]);
                setSaveMsg(`✅ ${mapped.length} itens extraídos via IA`);
            } else { setSaveMsg('⚠️ IA não encontrou itens orçamentários'); }
        } catch (e: any) { setSaveMsg('❌ ' + e.message); }
        finally { setIsExtracting(false); setTimeout(() => setSaveMsg(''), 5000); }
    };

    // Inline edit
    const updateItem = (id: string, field: keyof EngItem, value: any) => {
        setItems(prev => prev.map(it => {
            if (it.id !== id) return it;
            const updated = { ...it, [field]: value };
            if (field === 'unitCost' || field === 'quantity') {
                updated.unitPrice = applyBdi(updated.unitCost, effectiveBdi);
                updated.totalPrice = Math.round(updated.quantity * updated.unitPrice * 100) / 100;
            }
            return updated;
        }));
    };

    const removeItem = (id: string) => setItems(prev => prev.filter(it => it.id !== id));

    const addBlankItem = () => {
        setItems(prev => [...prev, {
            id: `new-${Date.now()}`, itemNumber: String(prev.length + 1), code: '', sourceName: 'PROPRIA',
            description: '', unit: 'UN', quantity: 1, unitCost: 0, unitPrice: 0, totalPrice: 0,
        }]);
    };

    // Search
    const handleSearch = async () => {
        if (!selectedBaseId || !searchQuery) return;
        setIsSearching(true);
        try {
            const res = await fetch(`/api/engineering/bases/${selectedBaseId}/items?q=${encodeURIComponent(searchQuery)}`, { headers: hdrs() });
            const data = await res.json();
            setSearchResults(data.items || []);
        } catch { } finally { setIsSearching(false); }
    };

    const addFromSearch = (dbItem: any) => {
        const base = bases.find(b => b.id === selectedBaseId);
        const cost = Number(dbItem.price) || 0;
        setItems(prev => [...prev, {
            id: `db-${Date.now()}`, itemNumber: String(prev.length + 1),
            code: dbItem.code, sourceName: base?.name || 'OFICIAL',
            description: dbItem.description, unit: dbItem.unit, quantity: 1,
            unitCost: cost, unitPrice: applyBdi(cost, effectiveBdi),
            totalPrice: applyBdi(cost, effectiveBdi),
        }]);
        setShowSearch(false); setSearchQuery(''); setSearchResults([]);
    };

    // BDI helpers
    const updateTcu = (field: keyof BdiTcuParams, val: number) => {
        setBdiConfig(prev => ({ ...prev, tcu: { ...prev.tcu, [field]: val } }));
    };

    // Excel Export (CSV with BOM for Excel compatibility)
    const handleExportExcel = () => {
        const BOM = '\uFEFF';
        const sep = ';';
        const header = ['Item', 'Base', 'Código', 'Descrição', 'Unidade', 'Quantidade', 'Custo Unitário (S/ BDI)', 'Preço Unitário (C/ BDI)', 'Total (C/ BDI)'];
        const rows = items.map(it => [
            it.itemNumber, it.sourceName, it.code, `"${it.description.replace(/"/g, '""')}"`,
            it.unit, it.quantity.toString().replace('.', ','),
            it.unitCost.toFixed(2).replace('.', ','),
            it.unitPrice.toFixed(2).replace('.', ','),
            it.totalPrice.toFixed(2).replace('.', ','),
        ]);
        rows.push([]);
        rows.push(['', '', '', '', '', '', 'Subtotal (S/ BDI)', '', items.reduce((s, i) => s + i.quantity * i.unitCost, 0).toFixed(2).replace('.', ',')]);
        rows.push(['', '', '', '', '', '', `BDI (${bdiConfig.mode})`, `${effectiveBdi.toFixed(2)}%`, '']);
        rows.push(['', '', '', '', '', '', 'TOTAL GLOBAL', '', items.reduce((s, i) => s + i.totalPrice, 0).toFixed(2).replace('.', ',')]);

        const csv = BOM + [header.join(sep), ...rows.map(r => r.join(sep))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `planilha_orcamentaria_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click(); URL.revokeObjectURL(url);
    };

    const inputStyle = (w: string = '100%'): React.CSSProperties => ({
        width: w, padding: '4px 8px', fontSize: '0.8rem', border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-base)', height: 30,
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>

            {/* Action Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-4)', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{ background: 'var(--color-primary-light)', padding: 8, borderRadius: 'var(--radius-md)' }}>
                        <TableProperties size={18} color="var(--color-primary)" />
                    </div>
                    <div>
                        <h3 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 700 }}>Planilha Orçamentária de Engenharia</h3>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                            {items.length} itens · BDI {effectiveBdi.toFixed(2)}% ({bdiConfig.mode})
                        </span>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    {saveMsg && <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{saveMsg}</span>}
                    <button className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={handleExtractAI} disabled={isExtracting}>
                        {isExtracting ? <Loader2 size={14} className="spin" /> : <Cpu size={14} color="var(--color-ai)" />}
                        {isExtracting ? 'Extraindo...' : 'Extrair via IA'}
                    </button>
                    <button className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={handleExportExcel}>
                        <Download size={14} /> Exportar Excel
                    </button>
                    <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={handleSave} disabled={isSaving}>
                        {isSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                        {isSaving ? 'Salvando...' : 'Salvar Planilha'}
                    </button>
                </div>
            </div>

            {/* Tab Bar */}
            <div style={{ display: 'flex', gap: 4, background: 'var(--color-bg-base)', padding: 4, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                {[
                    { key: 'planilha' as const, label: 'Planilha Orçamentária', icon: TableProperties },
                    { key: 'hub_insumos' as const, label: 'Hub de Insumos', icon: Package },
                    { key: 'curva_abc' as const, label: 'Curva ABC', icon: BarChart3 },
                    { key: 'cronograma' as const, label: 'Cronograma', icon: Calendar },
                ].map(tab => (
                    <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                        flex: 1, padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                        background: activeTab === tab.key ? 'var(--color-bg-surface)' : 'transparent',
                        boxShadow: activeTab === tab.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                        color: activeTab === tab.key ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                        fontWeight: activeTab === tab.key ? 700 : 500, fontSize: '0.85rem',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}>
                        <tab.icon size={15} /> {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content: Hub de Insumos */}
            {activeTab === 'hub_insumos' && (
                <InsumoHub proposalId={proposalId} />
            )}

            {/* Tab Content: Curva ABC */}
            {activeTab === 'curva_abc' && (
                <CurvaAbcPanel items={items} />
            )}

            {/* Tab Content: Cronograma */}
            {activeTab === 'cronograma' && (
                <CronogramaPanel items={items} />
            )}

            {/* Tab Content: Planilha */}
            {activeTab === 'planilha' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 'var(--space-4)' }}>

                {/* Table */}
                <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                        <thead>
                            <tr style={{ background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)' }}>
                                {['Item','Base','Código','Descrição do Serviço','Unid.','Qtd.','Custo (S/ BDI)','Preço (C/ BDI)',''].map((h,i) => (
                                    <th key={i} style={{ padding: '10px 12px', textAlign: i >= 5 ? 'right' : 'left', color: i === 7 ? 'var(--color-primary)' : 'var(--color-text-secondary)', fontWeight: i === 7 ? 700 : 600, width: i === 3 ? '30%' : undefined }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {items.map(it => (
                                <tr key={it.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <td style={{ padding: '6px 12px' }}>
                                        <input value={it.itemNumber} onChange={e => updateItem(it.id, 'itemNumber', e.target.value)} style={{ ...inputStyle('60px'), fontWeight: 700 }} />
                                    </td>
                                    <td style={{ padding: '6px 8px' }}>
                                        <span style={{ background: it.sourceName === 'PROPRIA' ? 'var(--color-success-light)' : 'rgba(37,99,235,0.08)', color: it.sourceName === 'PROPRIA' ? 'var(--color-success)' : 'var(--color-primary)', padding: '2px 6px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 700 }}>{it.sourceName}</span>
                                    </td>
                                    <td style={{ padding: '6px 8px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <input value={it.code} onChange={e => updateItem(it.id, 'code', e.target.value)} style={{ ...inputStyle('65px'), color: 'var(--color-text-secondary)' }} />
                                            {it.code && it.code !== 'N/A' && (
                                                <button title="Ver composição" onClick={() => setCompositionItem(it)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, opacity: 0.5 }}
                                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.5'; }}
                                                >
                                                    <Layers size={13} color="var(--color-primary)" />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                    <td style={{ padding: '6px 8px' }}>
                                        <input value={it.description} onChange={e => updateItem(it.id, 'description', e.target.value)} style={{ ...inputStyle(), fontWeight: 500 }} />
                                    </td>
                                    <td style={{ padding: '6px 8px' }}>
                                        <input value={it.unit} onChange={e => updateItem(it.id, 'unit', e.target.value)} style={{ ...inputStyle('55px'), textAlign: 'center' }} />
                                    </td>
                                    <td style={{ padding: '6px 8px' }}>
                                        <input type="number" value={it.quantity} onChange={e => updateItem(it.id, 'quantity', parseFloat(e.target.value) || 0)} style={{ ...inputStyle('70px'), textAlign: 'right' }} step="0.01" />
                                    </td>
                                    <td style={{ padding: '6px 8px' }}>
                                        <input type="number" value={it.unitCost} onChange={e => updateItem(it.id, 'unitCost', parseFloat(e.target.value) || 0)} style={{ ...inputStyle('90px'), textAlign: 'right' }} step="0.01" />
                                    </td>
                                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>{fmt(it.unitPrice)}</td>
                                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                        <button className="prop-icon-btn" onClick={() => removeItem(it.id)}><Trash2 size={14} color="var(--color-danger)" /></button>
                                    </td>
                                </tr>
                            ))}
                            {items.length === 0 && (
                                <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                                    Planilha vazia — Use "Extrair via IA" ou adicione itens manualmente
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                    <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-base)', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 8 }}>
                        <button className="btn btn-outline" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 6 }} onClick={addBlankItem}>
                            <Plus size={14} /> Adicionar Item
                        </button>
                        <button className="btn btn-outline" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setShowSearch(true)}>
                            <Search size={14} /> Buscar na Base Oficial
                        </button>
                    </div>
                </div>

                {/* BDI Panel + Totals */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

                    {/* BDI Calculator */}
                    <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: 'var(--space-4)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                            <Calculator size={16} color="var(--color-primary)" />
                            <h4 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 600 }}>Cálculo de BDI</h4>
                        </div>

                        <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-4)' }}>
                            {(['SIMPLIFICADO', 'TCU'] as const).map(mode => (
                                <button key={mode} onClick={() => setBdiConfig(prev => ({ ...prev, mode }))} style={{
                                    flex: 1, padding: 6, fontSize: '0.75rem', fontWeight: 600, borderRadius: 'var(--radius-sm)',
                                    border: '1px solid', cursor: 'pointer',
                                    borderColor: bdiConfig.mode === mode ? (mode === 'TCU' ? '#B45309' : 'var(--color-primary)') : 'var(--color-border)',
                                    background: bdiConfig.mode === mode ? (mode === 'TCU' ? 'rgba(180,83,9,0.08)' : 'var(--color-primary-light)') : 'transparent',
                                    color: bdiConfig.mode === mode ? (mode === 'TCU' ? '#B45309' : 'var(--color-primary)') : 'var(--color-text-secondary)',
                                }}>{mode === 'TCU' ? 'Fórmula TCU' : 'Simplificado'}</button>
                            ))}
                        </div>

                        {bdiConfig.mode === 'SIMPLIFICADO' ? (
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>BDI Global (%)</label>
                                <input type="number" className="form-input" value={bdiConfig.bdiGlobal}
                                    onChange={e => setBdiConfig(prev => ({ ...prev, bdiGlobal: parseFloat(e.target.value) || 0 }))}
                                    style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-primary)' }} step="0.01" />
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                    {([
                                        ['adminCentral', 'Adm. Central (%)'],
                                        ['seguros', 'Seguros (%)'],
                                        ['garantias', 'Garantias (%)'],
                                        ['riscos', 'Riscos (%)'],
                                    ] as const).map(([key, label]) => (
                                        <div key={key}>
                                            <label style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>{label}</label>
                                            <input type="number" className="form-input" value={bdiConfig.tcu[key]}
                                                onChange={e => updateTcu(key, parseFloat(e.target.value) || 0)}
                                                style={{ padding: '4px 8px', fontSize: '0.8rem' }} step="0.01" />
                                        </div>
                                    ))}
                                </div>
                                <div style={{ borderTop: '1px dashed var(--color-border)', margin: '4px 0' }} />
                                <div>
                                    <label style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>Desp. Financeiras (%)</label>
                                    <input type="number" className="form-input" value={bdiConfig.tcu.despFinanceiras}
                                        onChange={e => updateTcu('despFinanceiras', parseFloat(e.target.value) || 0)}
                                        style={{ padding: '4px 8px', fontSize: '0.8rem' }} step="0.01" />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>Lucro (%)</label>
                                    <input type="number" className="form-input" value={bdiConfig.tcu.lucro}
                                        onChange={e => updateTcu('lucro', parseFloat(e.target.value) || 0)}
                                        style={{ padding: '4px 8px', fontSize: '0.8rem' }} step="0.01" />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>Tributos — PIS+COFINS+ISS (%)</label>
                                    <input type="number" className="form-input" value={bdiConfig.tcu.tributos}
                                        onChange={e => updateTcu('tributos', parseFloat(e.target.value) || 0)}
                                        style={{ padding: '4px 8px', fontSize: '0.8rem' }} step="0.01" />
                                </div>
                                <div style={{ marginTop: 4, background: 'rgba(180,83,9,0.08)', padding: 10, borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                                    <span style={{ fontSize: '0.7rem', color: '#92400E', fontWeight: 600, display: 'block' }}>BDI CALCULADO (Acórdão TCU 2622)</span>
                                    <span style={{ fontSize: '1.4rem', color: '#B45309', fontWeight: 800 }}>{effectiveBdi.toFixed(2)}%</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Totals */}
                    <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                        <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Subtotal (S/ BDI)</span>
                            <span style={{ fontWeight: 600 }}>{fmt(subtotal)}</span>
                        </div>
                        <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                            <span style={{ color: 'var(--color-text-secondary)' }}>BDI ({effectiveBdi.toFixed(2)}%)</span>
                            <span style={{ fontWeight: 600, color: 'var(--color-success)' }}>+ {fmt(total - subtotal)}</span>
                        </div>
                        <div style={{ padding: 'var(--space-4)', background: 'linear-gradient(135deg, rgba(37,99,235,0.05), rgba(139,92,246,0.05))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Total Global</span>
                            <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-primary)' }}>{fmt(total)}</span>
                        </div>
                    </div>
                </div>
            </div>
            )}

            {/* Search Modal */}
            {showSearch && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: 'var(--color-bg-surface)', padding: 24, borderRadius: 12, width: 800, maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0 }}>Buscar Insumo/Serviço na Base Oficial</h3>
                            <button onClick={() => setShowSearch(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <select className="form-select" value={selectedBaseId} onChange={e => setSelectedBaseId(e.target.value)} style={{ width: 200 }}>
                                {bases.map(b => <option key={b.id} value={b.id}>{b.name} {b.uf || ''}</option>)}
                                {bases.length === 0 && <option value="">Nenhuma base cadastrada</option>}
                            </select>
                            <input type="text" className="form-input" placeholder="Buscar por código ou descrição..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} style={{ flex: 1 }} />
                            <button className="btn btn-primary" onClick={handleSearch} disabled={isSearching}>{isSearching ? 'Buscando...' : 'Buscar'}</button>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 8 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                <thead><tr style={{ background: 'var(--color-bg-base)' }}>
                                    {['Código','Descrição','Unid.','Preço',''].map((h,i) => <th key={i} style={{ padding: 8, textAlign: i >= 3 ? 'right' : 'left' }}>{h}</th>)}
                                </tr></thead>
                                <tbody>
                                    {searchResults.map(r => (
                                        <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: 8 }}><strong>{r.code}</strong></td>
                                            <td style={{ padding: 8 }}>{r.description}</td>
                                            <td style={{ padding: 8, textAlign: 'center' }}>{r.unit}</td>
                                            <td style={{ padding: 8, textAlign: 'right', fontWeight: 600 }}>{fmt(Number(r.price) || 0)}</td>
                                            <td style={{ padding: 8, textAlign: 'center' }}>
                                                <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: '0.7rem' }} onClick={() => addFromSearch(r)}>Adicionar</button>
                                            </td>
                                        </tr>
                                    ))}
                                    {searchResults.length === 0 && <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                        {searchQuery ? 'Nenhum resultado encontrado.' : 'Digite uma busca para começar.'}
                                    </td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* Composition Drawer */}
            {compositionItem && (
                <CompositionDrawer
                    code={compositionItem.code}
                    description={compositionItem.description}
                    onClose={() => setCompositionItem(null)}
                />
            )}
        </div>
    );
}
