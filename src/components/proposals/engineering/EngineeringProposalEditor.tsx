import { useState, useEffect } from 'react';
import { 
    Calculator, Plus, Save, Trash2, Cpu, 
    ChevronDown, Settings2, Download, TableProperties, CheckCircle2
} from 'lucide-react';

interface Props {
    proposalId: string;
    biddingId: string;
}

export function EngineeringProposalEditor({ proposalId, biddingId }: Props) {
    const [bdiMode, setBdiMode] = useState<'SIMPLIFICADO' | 'TCU'>('SIMPLIFICADO');
    const [bdiValue, setBdiValue] = useState(25.0);
    const [items, setItems] = useState([
        { id: '1', item: '1.1', code: 'C0054', source: 'SEINFRA', desc: 'Alvenaria de Tijolo Cerâmico Furado', unit: 'M2', qty: 150.5, cost: 45.20 },
        { id: '2', item: '1.2', code: '74209/1', source: 'SINAPI', desc: 'Pintura Látex Acrílica Duas Demãos', unit: 'M2', qty: 150.5, cost: 12.80 },
        { id: '3', item: '2.1', code: 'PR001', source: 'PRÓPRIA', desc: 'Limpeza Final da Obra', unit: 'CJ', qty: 1, cost: 1500.00 },
    ]);

    const [bases, setBases] = useState<any[]>([]);
    const [selectedBaseId, setSelectedBaseId] = useState<string>('');
    const [isExtracting, setIsExtracting] = useState(false);

    const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    useEffect(() => {
        // Fetch bases on mount
        fetch('/api/engineering/bases', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        })
        .then(res => res.json())
        .then(data => {
            if (Array.isArray(data)) {
                setBases(data);
                if (data.length > 0) setSelectedBaseId(data[0].id);
            }
        })
        .catch(console.error);
    }, []);

    const handleExtractAI = async () => {
        setIsExtracting(true);
        try {
            const res = await fetch('/api/engineering/ai-populate', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}` 
                },
                body: JSON.stringify({ biddingId })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Erro na extração');
            }

            const data = await res.json();
            if (data.items && data.items.length > 0) {
                // Map the AI extracted items to our grid format
                const newItems = data.items.map((aiItem: any, index: number) => ({
                    id: `ai-${Date.now()}-${index}`,
                    item: aiItem.item || String(index + 1),
                    code: aiItem.code || 'N/A',
                    source: aiItem.sourceName || 'PROPRIA',
                    desc: aiItem.description || '',
                    unit: aiItem.unit || 'UN',
                    qty: Number(aiItem.quantity) || 1,
                    cost: Number(aiItem.unitCost) || 0
                }));
                setItems(prev => [...prev, ...newItems]);
                alert(`Sucesso! ${newItems.length} itens extraídos da IA.`);
            } else {
                alert('A IA não encontrou itens orçamentários.');
            }
        } catch (e: any) {
            console.error(e);
            alert('Falha na extração AI: ' + e.message);
        } finally {
            setIsExtracting(false);
        }
    };

    const formatCurrency = (val: number) => val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const subtotal = items.reduce((acc, curr) => acc + (curr.qty * curr.cost), 0);
    const total = subtotal * (1 + (bdiValue / 100));

    const handleSearch = async () => {
        if (!selectedBaseId || !searchQuery) return;
        setIsSearching(true);
        try {
            const res = await fetch(`/api/engineering/bases/${selectedBaseId}/items?q=${encodeURIComponent(searchQuery)}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            const data = await res.json();
            setSearchResults(data.items || []);
        } catch (e) {
            console.error('Busca falhou', e);
        } finally {
            setIsSearching(false);
        }
    };

    const handleAddItem = (dbItem: any) => {
        const selectedBase = bases.find(b => b.id === selectedBaseId);
        setItems(prev => [...prev, {
            id: `manual-${Date.now()}`,
            item: String(prev.length + 1),
            code: dbItem.code,
            source: selectedBase?.name || 'OFICIAL',
            desc: dbItem.description,
            unit: dbItem.unit,
            qty: 1,
            cost: Number(dbItem.price) || 0
        }]);
        setIsSearchModalOpen(false);
        setSearchQuery('');
        setSearchResults([]);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
            
            {/* ── Action Bar ── */}
            <div style={{ 
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                padding: 'var(--space-4)', background: 'var(--color-bg-surface)', 
                borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{ background: 'var(--color-primary-light)', padding: '8px', borderRadius: 'var(--radius-md)' }}>
                        <TableProperties size={18} color="var(--color-primary)" />
                    </div>
                    <div>
                        <h3 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 700 }}>Planilha Orçamentária de Engenharia</h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>Base Principal:</span>
                            <select 
                                className="form-select" 
                                style={{ padding: '2px 8px', fontSize: '0.75rem', height: 'auto', width: 'auto' }}
                                value={selectedBaseId}
                                onChange={e => setSelectedBaseId(e.target.value)}
                            >
                                {bases.map(b => (
                                    <option key={b.id} value={b.id}>{b.name} {b.uf} ({b.version})</option>
                                ))}
                                {bases.length === 0 && <option value="">Carregando bases...</option>}
                            </select>
                        </div>
                    </div>
                </div>
                
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <button 
                        className="btn btn-outline" 
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                        onClick={handleExtractAI}
                        disabled={isExtracting}
                    >
                        <Cpu size={14} color="var(--color-ai)" /> 
                        {isExtracting ? 'Extraindo...' : 'Extrair PDF via IA'}
                    </button>
                    <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Save size={14} /> Salvar Planilha
                    </button>
                </div>
            </div>

            {/* ── BDI & Config Panel ── */}
            <div style={{ 
                display: 'grid', gridTemplateColumns: '1fr 300px', gap: 'var(--space-4)'
            }}>
                {/* Editor Grid */}
                <div style={{ 
                    background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', 
                    border: '1px solid var(--color-border)', overflow: 'hidden'
                }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                        <thead>
                            <tr style={{ background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)' }}>
                                <th style={{ padding: '10px 16px', textAlign: 'left', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Item</th>
                                <th style={{ padding: '10px 16px', textAlign: 'left', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Base</th>
                                <th style={{ padding: '10px 16px', textAlign: 'left', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Código</th>
                                <th style={{ padding: '10px 16px', textAlign: 'left', color: 'var(--color-text-secondary)', fontWeight: 600, width: '40%' }}>Descrição do Serviço</th>
                                <th style={{ padding: '10px 16px', textAlign: 'center', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Unid.</th>
                                <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Qtd.</th>
                                <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Custo (S/ BDI)</th>
                                <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--color-primary)', fontWeight: 700 }}>Preço (C/ BDI)</th>
                                <th style={{ padding: '10px 16px', textAlign: 'center' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map(it => {
                                const unitPrice = it.cost * (1 + (bdiValue / 100));
                                return (
                                <tr key={it.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <td style={{ padding: '10px 16px' }}><strong>{it.item}</strong></td>
                                    <td style={{ padding: '10px 16px' }}>
                                        <span style={{ 
                                            background: it.source === 'PRÓPRIA' ? 'var(--color-success-light)' : 'rgba(37,99,235,0.08)',
                                            color: it.source === 'PRÓPRIA' ? 'var(--color-success)' : 'var(--color-primary)',
                                            padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700
                                        }}>{it.source}</span>
                                    </td>
                                    <td style={{ padding: '10px 16px', color: 'var(--color-text-secondary)' }}>{it.code}</td>
                                    <td style={{ padding: '10px 16px', fontWeight: 500 }}>{it.desc}</td>
                                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>{it.unit}</td>
                                    <td style={{ padding: '10px 16px', textAlign: 'right' }}>{it.qty}</td>
                                    <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>{formatCurrency(it.cost)}</td>
                                    <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>{formatCurrency(unitPrice)}</td>
                                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                                        <button className="prop-icon-btn" onClick={() => setItems(items.filter(i => i.id !== it.id))}><Trash2 size={14} color="var(--color-danger)"/></button>
                                    </td>
                                </tr>
                                )
                            })}
                        </tbody>
                    </table>
                    <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-base)', borderTop: '1px solid var(--color-border)' }}>
                        <button 
                            className="btn btn-outline" 
                            style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 6 }}
                            onClick={() => setIsSearchModalOpen(true)}
                        >
                            <Plus size={14} /> Adicionar Serviço
                        </button>
                    </div>
                </div>

                {/* BDI Panel & Totals */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    
                    {/* BDI Calculator */}
                    <div style={{ 
                        background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', 
                        border: '1px solid var(--color-border)', padding: 'var(--space-4)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                            <Calculator size={16} color="var(--color-primary)" />
                            <h4 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 600 }}>Cálculo de BDI</h4>
                        </div>
                        
                        <div style={{ display: 'flex', gap: '8px', marginBottom: 'var(--space-4)' }}>
                            <button 
                                onClick={() => setBdiMode('SIMPLIFICADO')}
                                style={{ flex: 1, padding: '6px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid', borderColor: bdiMode === 'SIMPLIFICADO' ? 'var(--color-primary)' : 'var(--color-border)', background: bdiMode === 'SIMPLIFICADO' ? 'var(--color-primary-light)' : 'transparent', color: bdiMode === 'SIMPLIFICADO' ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
                            >Simplificado</button>
                            <button 
                                onClick={() => setBdiMode('TCU')}
                                style={{ flex: 1, padding: '6px', fontSize: '0.75rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid', borderColor: bdiMode === 'TCU' ? '#B45309' : 'var(--color-border)', background: bdiMode === 'TCU' ? 'rgba(180,83,9,0.08)' : 'transparent', color: bdiMode === 'TCU' ? '#B45309' : 'var(--color-text-secondary)' }}
                            >Fórmula TCU</button>
                        </div>

                        {bdiMode === 'SIMPLIFICADO' ? (
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px' }}>BDI Global (%)</label>
                                <input 
                                    type="number" className="form-input" value={bdiValue} 
                                    onChange={(e) => setBdiValue(parseFloat(e.target.value) || 0)} 
                                    style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-primary)' }}
                                />
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                    <div>
                                        <label style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>Adm. Central (%)</label>
                                        <input type="number" className="form-input" defaultValue={3.00} style={{ padding: '4px 8px', fontSize: '0.8rem' }}/>
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>Seguro/Gar. (%)</label>
                                        <input type="number" className="form-input" defaultValue={0.80} style={{ padding: '4px 8px', fontSize: '0.8rem' }}/>
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>Risco (%)</label>
                                        <input type="number" className="form-input" defaultValue={0.97} style={{ padding: '4px 8px', fontSize: '0.8rem' }}/>
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>Despesas Fin. (%)</label>
                                        <input type="number" className="form-input" defaultValue={0.59} style={{ padding: '4px 8px', fontSize: '0.8rem' }}/>
                                    </div>
                                </div>
                                <div style={{ borderTop: '1px dashed var(--color-border)', margin: '8px 0' }} />
                                <div>
                                    <label style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>Lucro (%)</label>
                                    <input type="number" className="form-input" defaultValue={6.16} style={{ padding: '4px 8px', fontSize: '0.8rem' }}/>
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>Tributos (PIS/COFINS/ISS) (%)</label>
                                    <input type="number" className="form-input" defaultValue={5.65} style={{ padding: '4px 8px', fontSize: '0.8rem' }}/>
                                </div>
                                <div style={{ marginTop: '8px', background: 'rgba(180,83,9,0.08)', padding: '10px', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                                    <span style={{ fontSize: '0.7rem', color: '#92400E', fontWeight: 600, display: 'block' }}>BDI CALCULADO</span>
                                    <span style={{ fontSize: '1.4rem', color: '#B45309', fontWeight: 800 }}>20.34%</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Totals */}
                    <div style={{ 
                        background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', 
                        border: '1px solid var(--color-border)', overflow: 'hidden'
                    }}>
                        <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Subtotal (S/ BDI)</span>
                            <span style={{ fontWeight: 600 }}>{formatCurrency(subtotal)}</span>
                        </div>
                        <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Total BDI ({bdiValue}%)</span>
                            <span style={{ fontWeight: 600, color: 'var(--color-success)' }}>+ {formatCurrency(total - subtotal)}</span>
                        </div>
                        <div style={{ 
                            padding: 'var(--space-4)', 
                            background: 'linear-gradient(135deg, rgba(37,99,235,0.05), rgba(139,92,246,0.05))',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                        }}>
                            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Total Global</span>
                            <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-primary)' }}>{formatCurrency(total)}</span>
                        </div>
                    </div>

                </div>
            </div>

            {/* ── Manual Search Modal ── */}
            {isSearchModalOpen && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                    <div style={{
                        background: 'var(--color-bg-surface)', padding: '24px', borderRadius: '12px',
                        width: '800px', maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: '16px',
                        boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0 }}>Adicionar Insumo/Serviço</h3>
                            <button onClick={() => setIsSearchModalOpen(false)} style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }}>&times;</button>
                        </div>
                        
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <input 
                                type="text" className="form-input" placeholder="Buscar por código ou descrição (ex: Argamassa, 74209)" 
                                value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                                style={{ flex: 1 }}
                            />
                            <button className="btn btn-primary" onClick={handleSearch} disabled={isSearching || !selectedBaseId}>
                                {isSearching ? 'Buscando...' : 'Buscar'}
                            </button>
                        </div>

                        {!selectedBaseId && <div style={{ color: 'var(--color-danger)' }}>Selecione uma Base Principal primeiro.</div>}

                        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                <thead>
                                    <tr style={{ background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)' }}>
                                        <th style={{ padding: '8px', textAlign: 'left' }}>Código</th>
                                        <th style={{ padding: '8px', textAlign: 'left' }}>Descrição</th>
                                        <th style={{ padding: '8px', textAlign: 'center' }}>Unid.</th>
                                        <th style={{ padding: '8px', textAlign: 'right' }}>Preço</th>
                                        <th style={{ padding: '8px', textAlign: 'center' }}>Ação</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {searchResults.map(res => (
                                        <tr key={res.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: '8px' }}><strong>{res.code}</strong></td>
                                            <td style={{ padding: '8px' }}>{res.description}</td>
                                            <td style={{ padding: '8px', textAlign: 'center' }}>{res.unit}</td>
                                            <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>
                                                {formatCurrency(Number(res.price) || 0)}
                                            </td>
                                            <td style={{ padding: '8px', textAlign: 'center' }}>
                                                <button 
                                                    className="btn btn-primary" style={{ padding: '4px 8px', fontSize: '0.7rem' }}
                                                    onClick={() => handleAddItem(res)}
                                                >Adicionar</button>
                                            </td>
                                        </tr>
                                    ))}
                                    {searchResults.length === 0 && !isSearching && searchQuery && (
                                        <tr><td colSpan={5} style={{ padding: '16px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Nenhum insumo encontrado.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
