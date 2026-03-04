import { useState, useMemo, useEffect } from 'react';
import {
    Sparkles, Plus, Trash2, Save, FileText, Loader2,
    Calculator, DollarSign, Package, AlertTriangle, Edit3,
    ChevronDown, ChevronUp, Brain, Briefcase
} from 'lucide-react';
import { API_BASE_URL } from '../../config';
import type { BiddingProcess, CompanyProfile, PriceProposal, ProposalItem } from '../../types';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
}

const UNITS = ['UN', 'KG', 'M²', 'M³', 'ML', 'HORA', 'MÊS', 'DIA', 'DIÁRIA', 'KM', 'LITRO', 'CJ', 'PCT', 'VB', 'SV'];

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ProposalGeneratorPage({ biddings, companies }: Props) {
    const [selectedBiddingId, setSelectedBiddingId] = useState('');
    const [selectedCompanyId, setSelectedCompanyId] = useState('');
    const [proposal, setProposal] = useState<PriceProposal | null>(null);
    const [proposals, setProposals] = useState<PriceProposal[]>([]);
    const [items, setItems] = useState<ProposalItem[]>([]);
    const [bdi, setBdi] = useState(0);
    const [validityDays, setValidityDays] = useState(60);
    const [isLoading, setIsLoading] = useState(false);
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [showConfig, setShowConfig] = useState(true);
    const [saveMessage, setSaveMessage] = useState('');

    const token = localStorage.getItem('token');
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Filter biddings with AI analysis
    const availableBiddings = useMemo(() =>
        biddings.filter(b => b.aiAnalysis)
        , [biddings]);

    const selectedBidding = biddings.find(b => b.id === selectedBiddingId);

    // Load proposals when bidding changes
    useEffect(() => {
        if (!selectedBiddingId) { setProposals([]); setProposal(null); setItems([]); return; }
        loadProposals();
    }, [selectedBiddingId]);

    const loadProposals = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/proposals/${selectedBiddingId}`, { headers });
            if (res.ok) {
                const data = await res.json();
                setProposals(data);
                if (data.length > 0) {
                    const latest = data[0]; // Already ordered by version desc
                    setProposal(latest);
                    setItems(latest.items || []);
                    setBdi(latest.bdiPercentage || 0);
                    setValidityDays(latest.validityDays || 60);
                    if (latest.companyProfileId) setSelectedCompanyId(latest.companyProfileId);
                }
            }
        } catch (e) {
            console.error('Failed to load proposals', e);
        }
    };

    // Create new proposal
    const handleCreateProposal = async () => {
        if (!selectedBiddingId || !selectedCompanyId) {
            alert('Selecione uma licitação e uma empresa.');
            return;
        }
        setIsLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/proposals`, {
                method: 'POST', headers,
                body: JSON.stringify({
                    biddingProcessId: selectedBiddingId,
                    companyProfileId: selectedCompanyId,
                    bdiPercentage: bdi,
                    validityDays,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                setProposal(data);
                setItems(data.items || []);
                setProposals(prev => [data, ...prev]);
                showSaveMsg('Proposta criada com sucesso!');
            }
        } catch (e) {
            alert('Erro ao criar proposta.');
        } finally {
            setIsLoading(false);
        }
    };

    // AI Populate items from edital
    const handleAiPopulate = async () => {
        if (!selectedBiddingId) return;
        setIsAiLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/proposals/ai-populate`, {
                method: 'POST', headers,
                body: JSON.stringify({ biddingProcessId: selectedBiddingId }),
            });
            if (res.ok) {
                const data = await res.json();
                if (data.items && data.items.length > 0) {
                    // If we have a proposal, save items to it
                    if (proposal) {
                        const saveRes = await fetch(`${API_BASE_URL}/api/proposals/${proposal.id}/items`, {
                            method: 'POST', headers,
                            body: JSON.stringify({ items: data.items.map((it: any) => ({ ...it, unitCost: it.referencePrice || 0 })), replaceAll: true }),
                        });
                        if (saveRes.ok) {
                            await loadProposals();
                            showSaveMsg(`${data.items.length} itens extraídos pela IA!`);
                        }
                    } else {
                        // Create proposal first
                        await handleCreateProposal();
                        // Then try again
                        setTimeout(async () => {
                            const latestRes = await fetch(`${API_BASE_URL}/api/proposals/${selectedBiddingId}`, { headers });
                            if (latestRes.ok) {
                                const latestData = await latestRes.json();
                                if (latestData[0]) {
                                    await fetch(`${API_BASE_URL}/api/proposals/${latestData[0].id}/items`, {
                                        method: 'POST', headers,
                                        body: JSON.stringify({ items: data.items.map((it: any) => ({ ...it, unitCost: it.referencePrice || 0 })), replaceAll: true }),
                                    });
                                    await loadProposals();
                                    showSaveMsg(`${data.items.length} itens extraídos pela IA!`);
                                }
                            }
                        }, 1000);
                    }
                } else {
                    alert('A IA não encontrou itens neste edital.');
                }
            } else {
                const err = await res.json();
                alert(err.error || 'Erro ao popular itens com IA.');
            }
        } catch (e) {
            alert('Erro ao consultar IA.');
        } finally {
            setIsAiLoading(false);
        }
    };

    // Add manual item
    const handleAddItem = () => {
        const newItem: ProposalItem = {
            id: `temp-${Date.now()}`,
            proposalId: proposal?.id || '',
            itemNumber: String(items.length + 1),
            description: '',
            unit: 'UN',
            quantity: 1,
            multiplier: 1,
            unitCost: 0,
            unitPrice: 0,
            totalPrice: 0,
            sortOrder: items.length,
        };
        setItems(prev => [...prev, newItem]);
        setEditingItemId(newItem.id);
    };

    // Update item locally
    const updateItem = (itemId: string, field: string, value: any) => {
        setItems(prev => prev.map(it => {
            if (it.id !== itemId) return it;
            const updated = { ...it, [field]: value };
            // Recalculate prices
            const unitPrice = (updated.unitCost || 0) * (1 + bdi / 100);
            const multiplier = updated.multiplier || 1;
            updated.unitPrice = Math.round(unitPrice * 100) / 100;
            updated.totalPrice = Math.round((updated.quantity || 0) * multiplier * unitPrice * 100) / 100;
            return updated;
        }));
    };

    // Save item to server
    const handleSaveItem = async (item: ProposalItem) => {
        if (!proposal) return;
        setIsSaving(true);
        try {
            if (item.id.startsWith('temp-')) {
                // Create
                const res = await fetch(`${API_BASE_URL}/api/proposals/${proposal.id}/items`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ items: [item], replaceAll: false }),
                });
                if (res.ok) {
                    await loadProposals();
                    showSaveMsg('Item salvo!');
                }
            } else {
                // Update
                const res = await fetch(`${API_BASE_URL}/api/proposals/${proposal.id}/items/${item.id}`, {
                    method: 'PUT', headers,
                    body: JSON.stringify(item),
                });
                if (res.ok) {
                    await loadProposals();
                    showSaveMsg('Item atualizado!');
                }
            }
        } catch (e) {
            alert('Erro ao salvar item.');
        } finally {
            setIsSaving(false);
            setEditingItemId(null);
        }
    };

    // Delete item
    const handleDeleteItem = async (itemId: string) => {
        if (itemId.startsWith('temp-')) {
            setItems(prev => prev.filter(it => it.id !== itemId));
            return;
        }
        if (!proposal) return;
        if (!confirm('Remover este item?')) return;
        try {
            await fetch(`${API_BASE_URL}/api/proposals/${proposal.id}/items/${itemId}`, {
                method: 'DELETE', headers,
            });
            await loadProposals();
            showSaveMsg('Item removido.');
        } catch (e) {
            alert('Erro ao remover item.');
        }
    };

    // Save BDI and config
    const handleSaveConfig = async () => {
        if (!proposal) return;
        setIsSaving(true);
        try {
            await fetch(`${API_BASE_URL}/api/proposals/${proposal.id}`, {
                method: 'PUT', headers,
                body: JSON.stringify({ bdiPercentage: bdi, validityDays }),
            });
            // Reload to recalculate prices with new BDI
            await loadProposals();
            showSaveMsg('Configurações salvas!');
        } catch (e) {
            alert('Erro ao salvar configurações.');
        } finally {
            setIsSaving(false);
        }
    };

    const showSaveMsg = (msg: string) => {
        setSaveMessage(msg);
        setTimeout(() => setSaveMessage(''), 3000);
    };

    // Totals
    const subtotal = useMemo(() => items.reduce((sum, it) => sum + (it.quantity * (it.multiplier || 1) * it.unitCost), 0), [items]);
    const bdiValue = useMemo(() => subtotal * (bdi / 100), [subtotal, bdi]);
    const total = useMemo(() => items.reduce((sum, it) => sum + (it.totalPrice || 0), 0), [items]);

    // Style consts
    const cardStyle: React.CSSProperties = {
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '16px',
        padding: '24px',
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* ── Top Config Bar ── */}
            <div style={{
                ...cardStyle,
                background: 'linear-gradient(135deg, rgba(37,99,235,0.03), rgba(139,92,246,0.03))',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <DollarSign size={22} color="var(--color-primary)" />
                        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                            Gerador de Proposta de Preços
                        </h2>
                    </div>
                    <button
                        onClick={() => setShowConfig(!showConfig)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)' }}
                    >
                        {showConfig ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                </div>

                {showConfig && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        {/* Licitação */}
                        <div>
                            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>
                                <Briefcase size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                                Licitação (com Análise IA)
                            </label>
                            <select
                                value={selectedBiddingId}
                                onChange={e => setSelectedBiddingId(e.target.value)}
                                style={{
                                    width: '100%', padding: '10px 12px', borderRadius: '10px',
                                    border: '1px solid var(--color-border)', fontSize: '0.875rem',
                                    background: 'var(--color-bg-base)',
                                }}
                            >
                                <option value="">Selecione uma licitação...</option>
                                {availableBiddings.map(b => (
                                    <option key={b.id} value={b.id}>
                                        {b.title?.substring(0, 80)} {b.estimatedValue > 0 ? `— ${fmt(b.estimatedValue)}` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Empresa */}
                        <div>
                            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>
                                <Package size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                                Empresa Proponente
                            </label>
                            <select
                                value={selectedCompanyId}
                                onChange={e => setSelectedCompanyId(e.target.value)}
                                style={{
                                    width: '100%', padding: '10px 12px', borderRadius: '10px',
                                    border: '1px solid var(--color-border)', fontSize: '0.875rem',
                                    background: 'var(--color-bg-base)',
                                }}
                            >
                                <option value="">Selecione a empresa...</option>
                                {companies.map(c => (
                                    <option key={c.id} value={c.id}>{c.razaoSocial} — {c.cnpj}</option>
                                ))}
                            </select>
                        </div>

                        {/* BDI */}
                        <div style={{ display: 'flex', gap: '16px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>
                                    <Calculator size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                                    BDI (%)
                                </label>
                                <input
                                    type="number"
                                    value={bdi}
                                    onChange={e => setBdi(parseFloat(e.target.value) || 0)}
                                    step="0.01"
                                    style={{
                                        width: '100%', padding: '10px 12px', borderRadius: '10px',
                                        border: '1px solid var(--color-border)', fontSize: '0.875rem',
                                    }}
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>
                                    Validade (dias)
                                </label>
                                <input
                                    type="number"
                                    value={validityDays}
                                    onChange={e => setValidityDays(parseInt(e.target.value) || 60)}
                                    style={{
                                        width: '100%', padding: '10px 12px', borderRadius: '10px',
                                        border: '1px solid var(--color-border)', fontSize: '0.875rem',
                                    }}
                                />
                            </div>
                        </div>

                        {/* Buttons */}
                        <div style={{ display: 'flex', alignItems: 'end', gap: '10px' }}>
                            {!proposal && (
                                <button
                                    className="btn btn-primary"
                                    onClick={handleCreateProposal}
                                    disabled={isLoading || !selectedBiddingId || !selectedCompanyId}
                                    style={{ padding: '10px 20px', borderRadius: '10px', fontWeight: 600 }}
                                >
                                    {isLoading ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
                                    Nova Proposta
                                </button>
                            )}
                            {proposal && (
                                <button
                                    className="btn btn-outline"
                                    onClick={handleSaveConfig}
                                    disabled={isSaving}
                                    style={{ padding: '10px 20px', borderRadius: '10px', fontWeight: 600 }}
                                >
                                    <Save size={16} /> Salvar Config
                                </button>
                            )}
                            <button
                                className="btn"
                                onClick={handleAiPopulate}
                                disabled={isAiLoading || !selectedBiddingId}
                                style={{
                                    padding: '10px 20px', borderRadius: '10px', fontWeight: 600,
                                    background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                                    color: 'white', border: 'none',
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                }}
                            >
                                {isAiLoading ? <Loader2 size={16} className="spin" /> : <Brain size={16} />}
                                {isAiLoading ? 'IA Extraindo...' : 'Preencher com IA'}
                            </button>
                        </div>
                    </div>
                )}

                {/* AI Loading badge */}
                {isAiLoading && (
                    <div style={{
                        marginTop: '12px', padding: '10px 16px', borderRadius: '10px',
                        background: 'linear-gradient(135deg, rgba(139,92,246,0.06), rgba(59,130,246,0.06))',
                        border: '1px solid rgba(139,92,246,0.2)',
                        display: 'flex', alignItems: 'center', gap: '8px',
                    }}>
                        <Loader2 size={14} color="#8b5cf6" className="spin" />
                        <span style={{ fontSize: '0.8rem', color: '#7c3aed', fontWeight: 600 }}>
                            Gemini analisando itens do edital...
                        </span>
                    </div>
                )}
            </div>

            {/* ── Save Message ── */}
            {saveMessage && (
                <div style={{
                    padding: '10px 18px', borderRadius: '10px',
                    background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)',
                    color: '#16a34a', fontWeight: 600, fontSize: '0.85rem',
                }}>
                    ✓ {saveMessage}
                </div>
            )}

            {/* ── Proposal Info ── */}
            {proposal && (
                <div style={{
                    display: 'flex', gap: '10px', alignItems: 'center', padding: '8px 16px',
                    borderRadius: '10px', background: 'rgba(37,99,235,0.05)',
                    border: '1px solid rgba(37,99,235,0.15)',
                }}>
                    <FileText size={16} color="var(--color-primary)" />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                        Proposta v{proposal.version}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
                        — {proposal.status} — {items.length} item(ns) — Total: {fmt(total)}
                    </span>
                    {proposals.length > 1 && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>
                            ({proposals.length} versões)
                        </span>
                    )}
                </div>
            )}

            {/* ── Items Table ── */}
            {(proposal || items.length > 0) && (
                <div style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Package size={18} color="var(--color-primary)" />
                            Itens da Proposta ({items.length})
                        </h3>
                        <button
                            className="btn btn-outline"
                            onClick={handleAddItem}
                            style={{ padding: '6px 14px', fontSize: '0.8rem', borderRadius: '8px' }}
                        >
                            <Plus size={14} /> Adicionar Item
                        </button>
                    </div>

                    <div style={{ overflowX: 'auto', borderRadius: '10px', border: '1px solid var(--color-border)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                            <thead>
                                <tr style={{ background: 'var(--color-bg-surface-hover)', borderBottom: '2px solid var(--color-border)' }}>
                                    <th style={thStyle}>#</th>
                                    <th style={{ ...thStyle, textAlign: 'left', minWidth: '250px' }}>Descrição</th>
                                    <th style={thStyle}>Unid</th>
                                    <th style={thStyle}>Qtd</th>
                                    <th style={thStyle}>Multiplicador</th>
                                    <th style={thStyle}>Custo Unit.</th>
                                    <th style={thStyle}>Preço Unit. (c/ BDI)</th>
                                    <th style={thStyle}>Total</th>
                                    <th style={{ ...thStyle, width: '50px' }}>Ref.</th>
                                    <th style={{ ...thStyle, width: '60px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item) => {
                                    const isEditing = editingItemId === item.id;
                                    const overRef = item.referencePrice && item.unitPrice > item.referencePrice;

                                    return (
                                        <tr key={item.id} style={{
                                            borderBottom: '1px solid var(--color-border)',
                                            background: overRef ? 'rgba(239,68,68,0.03)' : undefined,
                                        }}>
                                            <td style={tdCenterStyle}>{item.itemNumber}</td>
                                            <td style={tdStyle}>
                                                {isEditing ? (
                                                    <input
                                                        value={item.description}
                                                        onChange={e => updateItem(item.id, 'description', e.target.value)}
                                                        style={inputStyle}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    <span
                                                        onClick={() => setEditingItemId(item.id)}
                                                        style={{ cursor: 'pointer' }}
                                                        title="Clique para editar"
                                                    >
                                                        {item.description || '(sem descrição)'}
                                                    </span>
                                                )}
                                            </td>
                                            <td style={tdCenterStyle}>
                                                {isEditing ? (
                                                    <select
                                                        value={item.unit}
                                                        onChange={e => updateItem(item.id, 'unit', e.target.value)}
                                                        style={{ ...inputStyle, width: '70px', textAlign: 'center' }}
                                                    >
                                                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                                                    </select>
                                                ) : item.unit}
                                            </td>
                                            <td style={tdCenterStyle}>
                                                {isEditing ? (
                                                    <input
                                                        type="number"
                                                        value={item.quantity}
                                                        onChange={e => updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                                                        style={{ ...inputStyle, width: '60px', textAlign: 'right' }}
                                                        step="0.01"
                                                    />
                                                ) : fmtNum(item.quantity)}
                                            </td>
                                            <td style={tdCenterStyle}>
                                                {isEditing ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                                                        <input
                                                            type="number"
                                                            value={item.multiplier}
                                                            onChange={e => updateItem(item.id, 'multiplier', parseFloat(e.target.value) || 1)}
                                                            style={{ ...inputStyle, width: '50px', textAlign: 'center' }}
                                                            title="Multiplicador (ex: 12 meses)"
                                                        />
                                                        <input
                                                            type="text"
                                                            value={item.multiplierLabel || ''}
                                                            onChange={e => updateItem(item.id, 'multiplierLabel', e.target.value)}
                                                            placeholder="Rótulo (ex: Meses)"
                                                            style={{ ...inputStyle, width: '70px', fontSize: '0.7rem' }}
                                                        />
                                                    </div>
                                                ) : (
                                                    item.multiplier !== 1 ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                            <span>× {fmtNum(item.multiplier)}</span>
                                                            {item.multiplierLabel && <span style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>{item.multiplierLabel}</span>}
                                                        </div>
                                                    ) : '-'
                                                )}
                                            </td>
                                            <td style={tdCenterStyle}>
                                                {isEditing ? (
                                                    <input
                                                        type="number"
                                                        value={item.unitCost}
                                                        onChange={e => updateItem(item.id, 'unitCost', parseFloat(e.target.value) || 0)}
                                                        style={{ ...inputStyle, width: '90px', textAlign: 'right' }}
                                                        step="0.01"
                                                    />
                                                ) : fmt(item.unitCost)}
                                            </td>
                                            <td style={{ ...tdCenterStyle, fontWeight: 600, color: 'var(--color-primary)' }}>
                                                {fmt(item.unitPrice)}
                                            </td>
                                            <td style={{ ...tdCenterStyle, fontWeight: 700 }}>
                                                {fmt(item.totalPrice)}
                                            </td>
                                            <td style={tdCenterStyle}>
                                                {item.referencePrice ? (
                                                    <span style={{
                                                        fontSize: '0.7rem',
                                                        color: overRef ? '#ef4444' : '#22c55e',
                                                        fontWeight: 600,
                                                    }}>
                                                        {overRef && <AlertTriangle size={10} />}
                                                        {fmt(item.referencePrice)}
                                                    </span>
                                                ) : '-'}
                                            </td>
                                            <td style={tdCenterStyle}>
                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                    {isEditing ? (
                                                        <button
                                                            onClick={() => handleSaveItem(item)}
                                                            disabled={isSaving}
                                                            style={iconBtnStyle}
                                                            title="Salvar"
                                                        >
                                                            {isSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} color="#22c55e" />}
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => setEditingItemId(item.id)}
                                                            style={iconBtnStyle}
                                                            title="Editar"
                                                        >
                                                            <Edit3 size={14} color="var(--color-text-tertiary)" />
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleDeleteItem(item.id)}
                                                        style={iconBtnStyle}
                                                        title="Remover"
                                                    >
                                                        <Trash2 size={14} color="#ef4444" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {items.length === 0 && (
                                    <tr>
                                        <td colSpan={9} style={{
                                            textAlign: 'center', padding: '40px', color: 'var(--color-text-tertiary)',
                                            fontSize: '0.9rem',
                                        }}>
                                            <Sparkles size={32} color="var(--color-text-tertiary)" style={{ marginBottom: '8px' }} />
                                            <br />
                                            Nenhum item na proposta. Use o botão <strong>"Preencher com IA"</strong> para extrair os itens automaticamente do edital.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* ── Totals ── */}
                    {items.length > 0 && (
                        <div style={{
                            marginTop: '16px', display: 'flex', justifyContent: 'flex-end',
                        }}>
                            <div style={{
                                minWidth: '280px', padding: '16px 20px',
                                borderRadius: '12px',
                                background: 'linear-gradient(135deg, rgba(37,99,235,0.04), rgba(139,92,246,0.04))',
                                border: '1px solid rgba(37,99,235,0.15)',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
                                    <span style={{ color: 'var(--color-text-secondary)' }}>Subtotal (custo)</span>
                                    <span style={{ fontWeight: 500 }}>{fmt(subtotal)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
                                    <span style={{ color: 'var(--color-text-secondary)' }}>BDI ({fmtNum(bdi)}%)</span>
                                    <span style={{ fontWeight: 500 }}>{fmt(bdiValue)}</span>
                                </div>
                                <div style={{
                                    display: 'flex', justifyContent: 'space-between',
                                    borderTop: '2px solid var(--color-border)', paddingTop: '8px', marginTop: '4px',
                                    fontSize: '1.1rem', fontWeight: 800, color: 'var(--color-primary)',
                                }}>
                                    <span>TOTAL</span>
                                    <span>{fmt(total)}</span>
                                </div>
                                {selectedBidding && selectedBidding.estimatedValue > 0 && (
                                    <div style={{
                                        marginTop: '8px', fontSize: '0.75rem',
                                        color: total > selectedBidding.estimatedValue ? '#ef4444' : '#22c55e',
                                        fontWeight: 600, textAlign: 'right',
                                    }}>
                                        {total > selectedBidding.estimatedValue
                                            ? `⚠ Acima do estimado (${fmt(selectedBidding.estimatedValue)})`
                                            : `✓ Abaixo do estimado (${fmt(selectedBidding.estimatedValue)})`
                                        }
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Empty State ── */}
            {!proposal && items.length === 0 && (
                <div style={{
                    ...cardStyle, textAlign: 'center', padding: '60px',
                    color: 'var(--color-text-tertiary)',
                }}>
                    <DollarSign size={48} strokeWidth={1.5} style={{ marginBottom: '16px', opacity: 0.3 }} />
                    <h3 style={{ margin: '0 0 8px 0', fontWeight: 600, fontSize: '1.1rem' }}>
                        Nenhuma proposta selecionada
                    </h3>
                    <p style={{ margin: 0, fontSize: '0.9rem' }}>
                        Selecione uma licitação com análise IA e uma empresa para criar uma proposta de preços.
                    </p>
                </div>
            )}
        </div>
    );
}

// Styles
const thStyle: React.CSSProperties = {
    padding: '10px 12px', fontWeight: 700, fontSize: '0.75rem',
    color: 'var(--color-text-secondary)', textAlign: 'center',
    textTransform: 'uppercase', letterSpacing: '0.5px',
};
const tdStyle: React.CSSProperties = {
    padding: '8px 12px', verticalAlign: 'middle',
};
const tdCenterStyle: React.CSSProperties = {
    ...tdStyle, textAlign: 'center',
};
const inputStyle: React.CSSProperties = {
    padding: '4px 8px', borderRadius: '6px',
    border: '1px solid var(--color-primary)',
    fontSize: '0.8rem', width: '100%',
    background: 'var(--color-bg-base)',
};
const iconBtnStyle: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    padding: '4px', borderRadius: '4px',
};
