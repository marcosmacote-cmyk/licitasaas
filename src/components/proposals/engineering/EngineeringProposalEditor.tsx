import { useState } from 'react';
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

    const formatCurrency = (val: number) => val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const subtotal = items.reduce((acc, curr) => acc + (curr.qty * curr.cost), 0);
    const total = subtotal * (1 + (bdiValue / 100));

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
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>Múltiplas bases (SINAPI, SEINFRA) e BDI Acoplado</span>
                    </div>
                </div>
                
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <button className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Cpu size={14} color="var(--color-ai)" /> Extrair PDF via IA
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
                                        <button className="prop-icon-btn"><Trash2 size={14} color="var(--color-danger)"/></button>
                                    </td>
                                </tr>
                                )
                            })}
                        </tbody>
                    </table>
                    <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-base)', borderTop: '1px solid var(--color-border)' }}>
                        <button className="btn btn-outline" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 6 }}>
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
        </div>
    );
}
