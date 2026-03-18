import { useState } from 'react';
import {
    Plus, Trash2, Save, FileText, Loader2,
    DollarSign, Package, AlertTriangle, Edit3,
    ChevronDown, ChevronUp, Briefcase, Cpu, ScanSearch,
    Building2, TrendingUp, ClipboardList, RotateCcw,
} from 'lucide-react';
import type { BiddingProcess, CompanyProfile } from '../../types';
import { ConfirmDialog } from '../ui';
import { useProposal } from '../hooks/useProposal';
import { ProposalLetterWizard } from './letter/ProposalLetterWizard';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    initialBiddingId?: string;
}

const UNITS = ['UN', 'KG', 'M²', 'M³', 'ML', 'HORA', 'MÊS', 'DIA', 'DIÁRIA', 'KM', 'LITRO', 'CJ', 'PCT', 'VB', 'SV'];

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ProposalGeneratorPage({ biddings, companies, initialBiddingId }: Props) {
    const p = useProposal({ biddings, companies, initialBiddingId });
    const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);

    return (
        <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

            {/* ────────── CONFIG BLOCK ────────── */}
            <div style={{
                borderRadius: 'var(--radius-xl)',
                border: '1px solid rgba(37,99,235,0.18)',
                overflow: 'hidden',
                background: 'var(--color-bg-surface)',
                boxShadow: '0 2px 12px rgba(37,99,235,0.06)',
            }}>
                {/* Title bar */}
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: 'var(--space-5) var(--space-6)',
                    background: 'linear-gradient(135deg, rgba(37,99,235,0.07) 0%, rgba(99,102,241,0.04) 60%, rgba(139,92,246,0.03) 100%)',
                    borderBottom: '1px solid rgba(37,99,235,0.1)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                        <div style={{
                            width: 44, height: 44, borderRadius: 'var(--radius-lg)',
                            background: 'linear-gradient(135deg, rgba(37,99,235,0.15), rgba(99,102,241,0.1))',
                            border: '1px solid rgba(37,99,235,0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                            <DollarSign size={22} color="var(--color-primary)" strokeWidth={2} />
                        </div>
                        <div>
                            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
                                Elaboração de Proposta de Preços
                            </div>
                            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginTop: 3 }}>
                                {p.proposal
                                    ? `Proposta v${p.proposal.version} · ${p.items.length} item(ns) · configurada e pronta`
                                    : 'Selecione a licitação e empresa proponente para iniciar'}
                            </div>
                        </div>
                    </div>
                    <button onClick={() => p.setShowConfig(!p.showConfig)} style={{
                        background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.12)',
                        cursor: 'pointer', color: 'var(--color-primary)', padding: '6px 10px',
                        borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: 6,
                        fontSize: 'var(--text-sm)', fontWeight: 600,
                    }}>
                        {p.showConfig ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        {p.showConfig ? 'Recolher' : 'Configurar'}
                    </button>
                </div>

                {/* Config body */}
                {p.showConfig && (
                    <div style={{ padding: 'var(--space-5) var(--space-6)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 'var(--space-4)', alignItems: 'end' }}>
                            {/* Licitação */}
                            <div>
                                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>
                                    <Briefcase size={11} /> Licitação Alvo
                                </label>
                                <select value={p.selectedBiddingId} onChange={e => p.setSelectedBiddingId(e.target.value)} className="form-select" style={{ background: 'var(--color-bg-base)' }}>
                                    <option value="">Selecione uma licitação com análise IA...</option>
                                    {p.availableBiddings.map(b => (
                                        <option key={b.id} value={b.id}>
                                            {b.title?.substring(0, 80)} {b.estimatedValue > 0 ? `— ${fmt(b.estimatedValue)}` : ''}
                                        </option>
                                    ))}
                                </select>
                                {p.availableBiddings.length === 0 && (
                                    <div style={{ fontSize: '0.7rem', color: 'var(--color-warning)', marginTop: 4 }}>
                                        Nenhuma licitação com análise IA disponível.
                                    </div>
                                )}
                            </div>

                            {/* Empresa */}
                            <div>
                                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>
                                    <Building2 size={11} /> Empresa Proponente
                                </label>
                                <select value={p.selectedCompanyId} onChange={e => p.setSelectedCompanyId(e.target.value)} className="form-select" style={{ background: 'var(--color-bg-base)' }}>
                                    <option value="">Selecione a empresa...</option>
                                    {companies.map(c => (
                                        <option key={c.id} value={c.id}>{c.razaoSocial} — {c.cnpj}</option>
                                    ))}
                                </select>
                            </div>

                            {/* CTA Principal */}
                            <button className="btn btn-primary" onClick={p.handleCreateProposal}
                                disabled={p.isLoading || !p.selectedBiddingId || !p.selectedCompanyId}
                                style={{
                                    height: 40, padding: '0 var(--space-5)', borderRadius: 'var(--radius-lg)',
                                    fontWeight: 700, whiteSpace: 'nowrap',
                                    background: 'linear-gradient(135deg, var(--color-primary), rgba(99,102,241,0.9))',
                                    boxShadow: (!p.isLoading && p.selectedBiddingId && p.selectedCompanyId) ? '0 4px 14px rgba(37,99,235,0.3)' : undefined,
                                    border: 'none', display: 'flex', alignItems: 'center', gap: 8,
                                }}>
                                {p.isLoading ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
                                {p.proposal ? 'Nova Versão' : 'Iniciar Proposta'}
                            </button>
                        </div>

                    </div>
                )}

                {/* AI Loading badge */}
                {p.isAiLoading && (
                    <div style={{
                        margin: 'var(--space-4) var(--space-6)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-lg)',
                        background: 'linear-gradient(135deg, rgba(139,92,246,0.06), rgba(59,130,246,0.06))',
                        border: '1px solid rgba(139,92,246,0.2)',
                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    }}>
                        <Loader2 size={14} color="var(--color-primary)" className="spin" />
                        <span style={{ fontSize: 'var(--text-md)', color: 'var(--color-primary)', fontWeight: 'var(--font-semibold)' }}>
                            Gemini analisando itens do edital...
                        </span>
                    </div>
                )}
            </div>

            {/* ── Save Message ── */}
            {p.saveMessage && (
                <div style={{
                    padding: 'var(--space-3) var(--space-5)', borderRadius: 'var(--radius-lg)',
                    background: 'var(--color-success-bg)', border: '1px solid rgba(34,197,94,0.3)',
                    color: 'var(--color-success)', fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-md)',
                }}>
                    ✓ {p.saveMessage}
                </div>
            )}
            {/* ── Proposal Info + Actions ── */}
            {p.proposal && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3) var(--space-5)', borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <div style={{ width: 28, height: 28, borderRadius: 'var(--radius-sm)', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <FileText size={14} color="var(--color-primary)" />
                        </div>
                        <div>
                            <span style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--color-primary)' }}>Proposta v{p.proposal.version}</span>
                            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginLeft: 8 }}>{p.proposal.status} · {p.items.length} item(ns) · Total: <strong style={{ color: 'var(--color-text-primary)' }}>{fmt(p.total)}</strong></span>
                        </div>
                        {p.proposals.length > 1 && (
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', padding: '2px 8px', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-border)', background: 'var(--color-bg-body)' }}>
                                {p.proposals.length} versões
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <button className="btn btn-outline" onClick={p.handleSaveConfig} disabled={p.isSaving}
                            style={{ padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius-lg)', fontWeight: 600, fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Save size={14} /> Salvar em Dossiê
                        </button>
                    </div>
                </div>
            )}

            {/* ── TABS ── */}
            {p.proposal && (
                <div style={{ display: 'flex', gap: 'var(--space-2)', borderBottom: '2px solid var(--color-border)', marginBottom: '4px' }}>
                    <button onClick={() => p.setActiveTab('items')} className={`tab-btn${p.activeTab === 'items' ? ' active' : ''}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-5)', borderBottomWidth: '3px', transform: 'translateY(2px)' }}>
                        <Package size={16} /> Planilha de Preços
                    </button>
                    <button onClick={() => p.setActiveTab('letter')} className={`tab-btn${p.activeTab === 'letter' ? ' active' : ''}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-5)', borderBottomWidth: '3px', transform: 'translateY(2px)' }}>
                        <FileText size={16} /> Carta Proposta Redigida
                    </button>
                </div>
            )}

            {/* ── Items Tab ── */}
            {p.activeTab === 'items' && (p.proposal || p.items.length > 0) && (
                <div className="card p-6">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                        <h3 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                            Itens da Proposta ({p.items.length})
                        </h3>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                            {/* Rounding Mode Toggle */}
                            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--color-bg-base)', padding: '2px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', marginRight: '4px' }}>
                                <button onClick={() => p.setRoundingMode('ROUND')} style={{
                                    padding: '4px var(--space-2)', fontSize: 'var(--text-sm)', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                                    background: p.roundingMode === 'ROUND' ? 'var(--color-primary)' : 'transparent',
                                    color: p.roundingMode === 'ROUND' ? 'white' : 'var(--color-text-secondary)', fontWeight: 'var(--font-semibold)'
                                }}>Arredondar</button>
                                <button onClick={() => p.setRoundingMode('TRUNCATE')} style={{
                                    padding: '4px var(--space-2)', fontSize: 'var(--text-sm)', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                                    background: p.roundingMode === 'TRUNCATE' ? 'var(--color-primary)' : 'transparent',
                                    color: p.roundingMode === 'TRUNCATE' ? 'white' : 'var(--color-text-secondary)', fontWeight: 'var(--font-semibold)'
                                }}>Truncar</button>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', background: 'var(--color-bg-base)', padding: '6px var(--space-3)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', marginRight: 'var(--space-2)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', whiteSpace: 'nowrap' }}>BDI:</span>
                                    <input type="number" value={p.bdi} onChange={e => p.setBdi(parseFloat(e.target.value) || 0)} className="prop-input" style={{ width: '70px', height: '28px' }} step="0.01" />
                                    <span style={{ fontSize: '0.75rem' }}>%</span>
                                </div>
                                <div style={{ width: '1px', height: '20px', background: 'var(--color-border)' }}></div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', whiteSpace: 'nowrap' }}>Desc. Linear:</span>
                                    <input type="number" value={p.discount} onChange={e => p.setDiscount(parseFloat(e.target.value) || 0)} className="prop-input" style={{ width: '70px', height: '28px' }} step="0.01" />
                                    <span style={{ fontSize: '0.75rem' }}>%</span>
                                </div>
                            </div>

                            <button className="btn" onClick={p.handleAiPopulate} disabled={p.isAiLoading} style={{
                                padding: '6px var(--space-4)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-md)', fontWeight: 'var(--font-semibold)',
                                background: 'linear-gradient(135deg, var(--color-ai), var(--color-primary))', color: 'white', border: 'none',
                                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                            }}>
                                {p.isAiLoading ? <Loader2 size={14} className="spin" /> : <Cpu size={14} />}
                                Orçamento IA
                            </button>

                            <button className="btn btn-primary" onClick={p.handleSaveAllItems} disabled={p.isSaving}
                                style={{ padding: '6px var(--space-4)', fontSize: 'var(--text-md)', borderRadius: 'var(--radius-md)', background: 'var(--color-success)', color: 'white', border: 'none' }}>
                                {p.isSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Salvar Planilha
                            </button>

                            <button onClick={() => setShowRestoreConfirm(true)} style={{
                                padding: '6px var(--space-4)', borderRadius: 'var(--radius-md)',
                                background: 'rgba(245,158,11,0.08)', color: 'var(--color-warning)', border: '1px solid rgba(245,158,11,0.3)',
                                fontSize: 'var(--text-md)', fontWeight: 'var(--font-semibold)', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                            }} title="Restaurar preços para os valores de referência estimados">
                                <RotateCcw size={14} /> Restaurar Referência
                            </button>

                            <button onClick={p.handleExportExcel} style={{
                                padding: '6px var(--space-4)', borderRadius: 'var(--radius-md)',
                                background: 'var(--color-success-hover)', color: 'white', border: 'none',
                                fontSize: 'var(--text-md)', fontWeight: 'var(--font-semibold)', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 'var(--space-2)'
                            }}>
                                <Save size={14} /> Exportar Planilha
                            </button>

                            <button className="btn btn-outline" onClick={p.handleAddItem}
                                style={{ padding: '6px var(--space-4)', fontSize: 'var(--text-md)', borderRadius: 'var(--radius-md)' }}>
                                <Plus size={14} /> Novo Item
                            </button>
                        </div>
                    </div>

                    <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                            <thead>
                                <tr style={{ background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(99,102,241,0.04))', borderBottom: '2px solid var(--color-border)' }}>
                                    <th className="prop-th" style={{ width: 32, color: 'var(--color-text-tertiary)' }}>#</th>
                                    <th className="prop-th" style={{ textAlign: 'left', minWidth: '200px', color: 'var(--color-text-primary)', fontWeight: 700 }}>Descrição do Item</th>
                                    <th className="prop-th">Marca</th>
                                    <th className="prop-th">Modelo</th>
                                    <th className="prop-th">Unid.</th>
                                    <th className="prop-th">Qtd.</th>
                                    <th className="prop-th">Mult.</th>
                                    <th className="prop-th">Desc. Total (%)</th>
                                    <th className="prop-th">Custo Unit.</th>
                                    <th className="prop-th" style={{ color: 'var(--color-primary)', fontWeight: 700 }}>Preço Unit.</th>
                                    <th className="prop-th" style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>Total</th>
                                    <th className="prop-th">% Peso</th>
                                    <th className="prop-th" style={{ width: '50px' }}>Ref. Est.</th>
                                    <th className="prop-th" style={{ width: '60px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {p.items.map((item) => {
                                    const isEditing = p.isBulkEditing || p.editingItemId === item.id;
                                    const overRef = item.referencePrice && item.unitPrice > item.referencePrice;

                                    return (
                                        <tr key={item.id} style={{
                                            borderBottom: '1px solid var(--color-border)',
                                            background: overRef ? 'rgba(239,68,68,0.03)' : undefined,
                                        }}>
                                            <td className="prop-td-center">{item.itemNumber}</td>
                                            <td className="prop-td">
                                                {isEditing ? (
                                                    <input value={item.description} onChange={e => p.updateItem(item.id, 'description', e.target.value)} className="prop-input" autoFocus />
                                                ) : (
                                                    <span onClick={() => p.setEditingItemId(item.id)} className="cursor-pointer" title="Clique para editar">
                                                        {item.description || '(sem descrição)'}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="prop-td-center">
                                                {isEditing ? <input value={item.brand || ''} onChange={e => p.updateItem(item.id, 'brand', e.target.value)} style={{ width: '80px', textAlign: 'center' }} className="prop-input" placeholder="Marca" /> : item.brand || '-'}
                                            </td>
                                            <td className="prop-td-center">
                                                {isEditing ? <input value={item.model || ''} onChange={e => p.updateItem(item.id, 'model', e.target.value)} className="prop-input" style={{ width: '100px', textAlign: 'center' }} placeholder="Modelo" /> : item.model || '-'}
                                            </td>
                                            <td className="prop-td-center">
                                                {isEditing ? (
                                                    <select value={item.unit} onChange={e => p.updateItem(item.id, 'unit', e.target.value)} className="prop-input" style={{ width: '70px', textAlign: 'center' }}>
                                                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                                                    </select>
                                                ) : item.unit}
                                            </td>
                                            <td className="prop-td-center">
                                                {isEditing ? <input type="number" value={item.quantity} onChange={e => p.updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)} className="prop-input" style={{ width: '60px', textAlign: 'right' }} step="0.01" /> : fmtNum(item.quantity)}
                                            </td>
                                            <td className="prop-td-center">
                                                {isEditing ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                                                        <input type="number" value={item.multiplier} onChange={e => p.updateItem(item.id, 'multiplier', parseFloat(e.target.value) || 1)} className="prop-input" style={{ width: '50px', textAlign: 'center' }} title="Multiplicador (ex: 12 meses)" />
                                                        <input type="text" value={item.multiplierLabel || ''} onChange={e => p.updateItem(item.id, 'multiplierLabel', e.target.value)} placeholder="Rótulo (ex: Meses)" className="prop-input" style={{ width: '70px', fontSize: '0.7rem' }} />
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
                                            <td className="prop-td-center">
                                                {isEditing ? <input type="number" value={item.discountPercentage || 0} onChange={e => p.updateItem(item.id, 'discountPercentage', parseFloat(e.target.value) || 0)} className="prop-input" style={{ width: '50px', textAlign: 'center' }} step="0.1" /> : (() => {
                                                    // Desconto Total = diferença percentual entre referência e preço atual
                                                    if (item.referencePrice && item.referencePrice > 0) {
                                                        const totalDisc = ((item.referencePrice - item.unitPrice) / item.referencePrice * 100);
                                                        const isNegative = totalDisc < 0;
                                                        return <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isNegative ? 'var(--color-danger)' : totalDisc > 0 ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
                                                            {totalDisc > 0 ? '-' : ''}{Math.abs(totalDisc).toFixed(2)}%
                                                        </span>;
                                                    }
                                                    // Sem referência: mostra desconto aplicado (individual ou linear)
                                                    const appliedDisc = item.discountPercentage || p.discount || 0;
                                                    return appliedDisc > 0 ? `${appliedDisc.toFixed(2)}%` : '-';
                                                })()}
                                            </td>
                                            <td className="prop-td-center">
                                                {isEditing ? <input type="number" value={item.unitCost} onChange={e => p.updateItem(item.id, 'unitCost', parseFloat(e.target.value) || 0)} className="prop-input" style={{ width: '90px', textAlign: 'right' }} step="0.01" /> : fmt(item.unitCost)}
                                            </td>
                                            <td className="prop-td-center" style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{fmt(item.unitPrice)}</td>
                                            <td className="prop-td-center" style={{ fontWeight: 700 }}>{fmt(item.totalPrice)}</td>
                                            <td className="prop-td-center" style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                                                {p.total > 0 ? ((item.totalPrice / p.total) * 100).toFixed(2) + '%' : '0.00%'}
                                            </td>
                                            <td className="prop-td-center">
                                                {item.referencePrice ? (
                                                    <span style={{ fontSize: '0.7rem', color: overRef ? 'var(--color-danger)' : 'var(--color-success)', fontWeight: 600 }}>
                                                        {overRef && <AlertTriangle size={10} />}
                                                        {fmt(item.referencePrice)}
                                                    </span>
                                                ) : '-'}
                                            </td>
                                            <td className="prop-td-center">
                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                    {isEditing ? (
                                                        !p.isBulkEditing && (
                                                            <button onClick={() => p.handleSaveAllItems()} disabled={p.isSaving} className="prop-icon-btn" title="Salvar">
                                                                {p.isSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} color="var(--color-success)" />}
                                                            </button>
                                                        )
                                                    ) : (
                                                        <button onClick={() => p.setIsBulkEditing(true)} className="prop-icon-btn" title="Editar">
                                                            <Edit3 size={14} color="var(--color-text-tertiary)" />
                                                        </button>
                                                    )}
                                                    <button onClick={() => p.handleDeleteItem(item.id)} className="prop-icon-btn" title="Remover">
                                                        <Trash2 size={14} color="var(--color-danger)" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {p.items.length === 0 && (
                                    <tr>
                                        <td colSpan={14} style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-tertiary)' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                                                <ScanSearch size={28} color="var(--color-text-tertiary)" strokeWidth={1.5} />
                                                <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Planilha vazia</span>
                                                <span style={{ fontSize: 'var(--text-sm)' }}>Use <strong>"Orçamento IA"</strong> para extrair os itens automaticamente do edital.</span>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* ── Totals ── */}
                    {p.items.length > 0 && (
                        <div style={{ marginTop: 'var(--space-4)', display: 'flex', justifyContent: 'flex-end' }}>
                            <div style={{
                                minWidth: '300px', borderRadius: 'var(--radius-xl)',
                                overflow: 'hidden', border: '1px solid var(--color-border)',
                            }}>
                                <div style={{ padding: 'var(--space-3) var(--space-5)', background: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                    <span style={{ color: 'var(--color-text-secondary)' }}>Subtotal (custo)</span>
                                    <span style={{ fontWeight: 500 }}>{fmt(p.subtotal)}</span>
                                </div>
                                <div style={{ padding: 'var(--space-3) var(--space-5)', background: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                    <span style={{ color: 'var(--color-text-secondary)' }}>Arredondamento</span>
                                    <span style={{ fontWeight: 500, color: 'var(--color-text-tertiary)' }}>{p.roundingMode === 'ROUND' ? 'Arredondar' : 'Truncar'}</span>
                                </div>
                                <div style={{
                                    padding: 'var(--space-4) var(--space-5)',
                                    background: 'linear-gradient(135deg, rgba(37,99,235,0.05), rgba(139,92,246,0.05))',
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                }}>
                                    <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Global</span>
                                    <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-primary)' }}>{fmt(p.total)}</span>
                                </div>
                                {p.selectedBidding && p.selectedBidding.estimatedValue > 0 && (
                                    <div style={{
                                        padding: 'var(--space-2) var(--space-5)',
                                        background: p.total > p.selectedBidding.estimatedValue ? 'var(--color-danger-bg)' : 'var(--color-success-bg)',
                                        borderTop: `1px solid ${p.total > p.selectedBidding.estimatedValue ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}`,
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        fontSize: '0.8rem', fontWeight: 600,
                                        color: p.total > p.selectedBidding.estimatedValue ? 'var(--color-danger)' : 'var(--color-success)',
                                    }}>
                                        <span>{p.total > p.selectedBidding.estimatedValue ? 'Acima do estimado' : 'Abaixo do estimado'}</span>
                                        <span>{fmt(p.selectedBidding.estimatedValue)}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Letter Tab (Wizard V2) ── */}
            {p.activeTab === 'letter' && p.proposal && p.selectedBidding && p.selectedCompany && (
                <ProposalLetterWizard
                    bidding={p.selectedBidding}
                    company={p.selectedCompany}
                    proposal={p.proposal}
                    items={p.items}
                    totalValue={p.total}
                    validityDays={p.validityDays}
                    signatureMode={p.signatureMode as 'LEGAL' | 'TECH' | 'BOTH'}
                    bdi={p.bdi}
                    discount={p.discount}
                    headerImage={p.headerImage}
                    footerImage={p.footerImage}
                    headerImageHeight={p.headerImageHeight}
                    footerImageHeight={p.footerImageHeight}
                    setValidityDays={p.setValidityDays}
                    setSignatureMode={p.setSignatureMode as (v: 'LEGAL' | 'TECH' | 'BOTH') => void}
                    setHeaderImage={p.setHeaderImage}
                    setFooterImage={p.setFooterImage}
                    setHeaderImageHeight={p.setHeaderImageHeight}
                    setFooterImageHeight={p.setFooterImageHeight}
                    handleImageUpload={p.handleImageUpload}
                    handleSaveConfig={p.handleSaveConfig}
                    handleSaveCompanyTemplate={p.handleSaveCompanyTemplate}
                    isSavingTemplate={p.isSavingTemplate}
                    letterContent={p.letterContent}
                    setLetterContent={p.setLetterContent}
                    handleSaveLetter={p.handleSaveLetter}
                    handlePrintProposal={p.handlePrintProposal}
                    isSaving={p.isSaving}
                    printLandscape={p.printLandscape}
                    setPrintLandscape={p.setPrintLandscape}
                    sigLegal={p.sigLegal}
                    setSigLegal={p.setSigLegal}
                    sigTech={p.sigTech}
                    setSigTech={p.setSigTech}
                    sigCompany={p.sigCompany}
                    setSigCompany={p.setSigCompany}
                    bankData={p.bankData}
                    setBankData={p.setBankData}
                />
            )}
            {p.activeTab === 'letter' && (!p.proposal || !p.selectedBidding || !p.selectedCompany) && (
                <div className="card p-6" style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                    <FileText size={32} style={{ margin: '0 auto var(--space-3)', opacity: 0.3 }} />
                    <p>Selecione a licitação, empresa e inicie a proposta para acessar a carta.</p>
                </div>
            )}

            {/* ────────── EMPTY STATE ────────── */}
            {!p.proposal && p.items.length === 0 && (
                <div style={{
                    borderRadius: 'var(--radius-xl)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg-surface)',
                    overflow: 'hidden',
                    display: 'grid', gridTemplateColumns: '1fr 1.1fr',
                    minHeight: 320,
                }}>
                    {/* LEFT: editorial copy */}
                    <div style={{
                        padding: 'var(--space-12) var(--space-10)',
                        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 'var(--space-5)',
                        borderRight: '1px solid var(--color-border)',
                        background: 'linear-gradient(160deg, rgba(37,99,235,0.03) 0%, transparent 60%)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                            <div style={{
                                width: 52, height: 52, borderRadius: 'var(--radius-xl)',
                                background: 'linear-gradient(135deg, rgba(37,99,235,0.12), rgba(99,102,241,0.08))',
                                border: '1px solid rgba(37,99,235,0.18)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <DollarSign size={24} color="var(--color-primary)" strokeWidth={1.75} />
                            </div>
                            <div>
                                <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-primary)', marginBottom: 2 }}>Estágio ativo</div>
                                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1.1, letterSpacing: '-0.02em' }}>Composição de Proposta</div>
                            </div>
                        </div>

                        <p style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--color-text-secondary)', lineHeight: 1.65, maxWidth: 320 }}>
                            Selecione a <strong>licitação</strong> e a <strong>empresa proponente</strong> acima, e
                            clique em <strong>Iniciar Proposta</strong> para abrir a planilha de preços com os itens do edital.
                        </p>

                        {/* Feature list */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                            {[
                                { icon: <Cpu size={13} />, text: 'Orçamento automático via IA a partir do edital' },
                                { icon: <TrendingUp size={13} />, text: 'Composição com BDI, desconto e multiplicadores' },
                                { icon: <FileText size={13} />, text: 'Carta proposta redigida com suporte da IA' },
                                { icon: <ClipboardList size={13} />, text: 'Exportação completa: planilha + carta em PDF' },
                            ].map((f, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                                    <span style={{ color: 'var(--color-primary)', opacity: 0.7, display: 'flex' }}>{f.icon}</span>
                                    {f.text}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* RIGHT: ghost spreadsheet preview */}
                    <div style={{ padding: 'var(--space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', justifyContent: 'center' }}>
                        {/* Fake table header */}
                        <div style={{ display: 'grid', gridTemplateColumns: '2rem 3fr 1fr 1fr 1fr 1fr', gap: 4, marginBottom: 4, opacity: 0.35 }}>
                            {['#', 'Descrição do Item', 'Qtd.', 'Custo Unit.', 'Preço Unit.', 'Total'].map((h) => (
                                <div key={h} style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--color-text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: h !== 'Descrição do Item' ? 'right' : 'left', paddingBottom: 6, borderBottom: '2px solid var(--color-border)' }}>{h}</div>
                            ))}
                        </div>
                        {/* Fake rows */}
                        {[0.8, 1, 0.65, 0.9, 0.75, 0.55].map((op, i) => (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2rem 3fr 1fr 1fr 1fr 1fr', gap: 4, opacity: op * 0.28 }}>
                                <div style={{ height: 16, borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                                <div style={{ height: 16, borderRadius: 3, background: 'var(--color-text-tertiary)', width: `${55 + i * 7}%` }} />
                                <div style={{ height: 16, borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                                <div style={{ height: 16, borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                                <div style={{ height: 16, borderRadius: 3, background: 'var(--color-primary)', opacity: 0.4 }} />
                                <div style={{ height: 16, borderRadius: 3, background: 'var(--color-primary)', opacity: 0.6 }} />
                            </div>
                        ))}
                        {/* Total stub */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-3)', opacity: 0.2 }}>
                            <div style={{ width: 180, padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ height: 12, width: 60, borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                                <div style={{ height: 16, width: 70, borderRadius: 3, background: 'var(--color-primary)' }} />
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
            <ConfirmDialog
                open={!!p.confirmDeleteItemId}
                title="Remover Item"
                message="Tem certeza que deseja remover este item da proposta?"
                variant="danger"
                confirmLabel="Remover"
                onConfirm={p.executeDeleteItem}
                onCancel={() => p.setConfirmDeleteItemId(null)}
            />
            <ConfirmDialog
                open={showRestoreConfirm}
                title="Restaurar Preços de Referência"
                message="Tem certeza que deseja restaurar os preços de referência? Todos os custos unitários serão recalculados com base nos valores estimados do edital, e os descontos (linear e individuais) serão zerados."
                variant="danger"
                confirmLabel="Restaurar"
                onConfirm={() => { p.handleRestoreReferencePrice(); setShowRestoreConfirm(false); }}
                onCancel={() => setShowRestoreConfirm(false)}
            />
        </>
    );
}
