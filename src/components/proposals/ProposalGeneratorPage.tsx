import {
    Sparkles, Plus, Trash2, Save, FileText, Loader2,
    DollarSign, Package, AlertTriangle, Edit3,
    ChevronDown, ChevronUp, Brain, Briefcase, Printer
} from 'lucide-react';
import type { BiddingProcess, CompanyProfile } from '../../types';
import { ConfirmDialog } from '../ui';
import { useProposal } from '../hooks/useProposal';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
}

const UNITS = ['UN', 'KG', 'M²', 'M³', 'ML', 'HORA', 'MÊS', 'DIA', 'DIÁRIA', 'KM', 'LITRO', 'CJ', 'PCT', 'VB', 'SV'];

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ProposalGeneratorPage({ biddings, companies }: Props) {
    const p = useProposal({ biddings, companies });

    return (
        <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

            {/* ── Top Config Bar ── */}
            <div className="card" style={{
                padding: 'var(--space-6)',
                background: 'linear-gradient(135deg, rgba(37,99,235,0.03), rgba(139,92,246,0.03))',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <DollarSign size={22} color="var(--color-primary)" />
                        <h2 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-primary)' }}>
                            Gerador de Proposta de Preços
                        </h2>
                    </div>
                    <button onClick={() => p.setShowConfig(!p.showConfig)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)' }}>
                        {p.showConfig ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                </div>

                {p.showConfig && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                        {/* Licitação */}
                        <div>
                            <label className="form-label">
                                <Briefcase size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                                Licitação (com Análise IA)
                            </label>
                            <select value={p.selectedBiddingId} onChange={e => p.setSelectedBiddingId(e.target.value)} className="form-select" style={{ background: 'var(--color-bg-base)' }}>
                                <option value="">Selecione uma licitação...</option>
                                {p.availableBiddings.map(b => (
                                    <option key={b.id} value={b.id}>
                                        {b.title?.substring(0, 80)} {b.estimatedValue > 0 ? `— ${fmt(b.estimatedValue)}` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Empresa */}
                        <div>
                            <label className="form-label">
                                <Package size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                                Empresa Proponente
                            </label>
                            <select value={p.selectedCompanyId} onChange={e => p.setSelectedCompanyId(e.target.value)} className="form-select" style={{ background: 'var(--color-bg-base)' }}>
                                <option value="">Selecione a empresa...</option>
                                {companies.map(c => (
                                    <option key={c.id} value={c.id}>{c.razaoSocial} — {c.cnpj}</option>
                                ))}
                            </select>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'end', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                            <button className="btn btn-primary" onClick={p.handleCreateProposal} disabled={p.isLoading || !p.selectedBiddingId || !p.selectedCompanyId}
                                style={{ padding: 'var(--space-3) var(--space-5)', borderRadius: 'var(--radius-lg)', fontWeight: 'var(--font-semibold)' }}>
                                {p.isLoading ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
                                Nova Proposta
                            </button>
                            {p.proposal && (
                                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                                    <button className="btn btn-outline" onClick={p.handleSaveConfig} disabled={p.isSaving}
                                        style={{ padding: 'var(--space-3) var(--space-5)', borderRadius: 'var(--radius-lg)', fontWeight: 'var(--font-semibold)' }}>
                                        <Save size={16} /> Salvar Proposta em Dossiê
                                    </button>

                                    <label style={{
                                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer',
                                        padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-lg)',
                                        backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                                    }}>
                                        <input type="checkbox" checked={p.printLandscape} onChange={(e) => p.setPrintLandscape(e.target.checked)}
                                            style={{ width: '16px', height: '16px', accentColor: 'var(--color-primary)' }} />
                                        <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-medium)', color: 'var(--color-text-secondary)' }}>Paisagem</span>
                                    </label>

                                    <div style={{ display: 'flex', gap: '4px', background: 'var(--color-bg-base)', padding: '2px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                                        <button className="btn" onClick={() => p.handlePrintProposal('LETTER')} title="Exportar Apenas Carta"
                                            style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', border: 'none', background: 'none', color: 'var(--color-text-secondary)' }}>
                                            <FileText size={14} /> Carta
                                        </button>
                                        <button className="btn" onClick={() => p.handlePrintProposal('SPREADSHEET')} title="Exportar Apenas Planilha"
                                            style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', border: 'none', background: 'none', color: 'var(--color-text-secondary)' }}>
                                            <Package size={14} /> Planilha
                                        </button>
                                        <div style={{ width: '1px', background: 'var(--color-border)', margin: '4px 2px' }}></div>
                                        <button className="btn btn-primary" onClick={() => p.handlePrintProposal('FULL')}
                                            style={{ padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius-md)', fontWeight: 'var(--font-bold)', background: 'var(--color-text-primary)', fontSize: 'var(--text-md)' }}>
                                            <Printer size={16} /> Exportar Completa
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* AI Loading badge */}
                {p.isAiLoading && (
                    <div style={{
                        marginTop: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-lg)',
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

            {/* ── Proposal Info ── */}
            {p.proposal && (
                <div style={{
                    display: 'flex', gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-2) var(--space-4)',
                    borderRadius: 'var(--radius-lg)', background: 'var(--color-primary-light)',
                    border: '1px solid rgba(37,99,235,0.15)',
                }}>
                    <FileText size={16} color="var(--color-primary)" />
                    <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-semibold)', color: 'var(--color-primary)' }}>
                        Proposta v{p.proposal.version}
                    </span>
                    <span style={{ fontSize: 'var(--text-md)', color: 'var(--color-text-tertiary)' }}>
                        — {p.proposal.status} — {p.items.length} item(ns) — Total: {fmt(p.total)}
                    </span>
                    {p.proposals.length > 1 && (
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                            ({p.proposals.length} versões)
                        </span>
                    )}
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
                <div className="card" style={{ padding: 'var(--space-6)' }}>
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
                                    <input type="number" value={p.bdi} onChange={e => p.setBdi(parseFloat(e.target.value) || 0)} className="prop-input" style={{ width: '55px', height: '28px' }} />
                                    <span style={{ fontSize: '0.75rem' }}>%</span>
                                </div>
                                <div style={{ width: '1px', height: '20px', background: 'var(--color-border)' }}></div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', whiteSpace: 'nowrap' }}>Desc. Linear:</span>
                                    <input type="number" value={p.discount} onChange={e => p.setDiscount(parseFloat(e.target.value) || 0)} className="prop-input" style={{ width: '55px', height: '28px' }} />
                                    <span style={{ fontSize: '0.75rem' }}>%</span>
                                </div>
                            </div>

                            <button className="btn" onClick={p.handleAiPopulate} disabled={p.isAiLoading} style={{
                                padding: '6px var(--space-4)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-md)', fontWeight: 'var(--font-semibold)',
                                background: 'linear-gradient(135deg, var(--color-ai), var(--color-primary))', color: 'white', border: 'none',
                                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                            }}>
                                {p.isAiLoading ? <Loader2 size={14} className="spin" /> : <Brain size={14} />}
                                Orçamento IA
                            </button>

                            <button className="btn btn-primary" onClick={p.handleSaveAllItems} disabled={p.isSaving}
                                style={{ padding: '6px var(--space-4)', fontSize: 'var(--text-md)', borderRadius: 'var(--radius-md)', background: 'var(--color-success)', color: 'white', border: 'none' }}>
                                {p.isSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Salvar Planilha
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
                                <tr style={{ background: 'var(--color-bg-surface-hover)', borderBottom: '2px solid var(--color-border)' }}>
                                    <th className="prop-th">#</th>
                                    <th className="prop-th" style={{ textAlign: 'left', minWidth: '200px' }}>Descrição</th>
                                    <th className="prop-th">Marca</th>
                                    <th className="prop-th">Modelo</th>
                                    <th className="prop-th">Unid</th>
                                    <th className="prop-th">Qtd</th>
                                    <th className="prop-th">Multiplicador</th>
                                    <th className="prop-th">Desc. (%)</th>
                                    <th className="prop-th">Custo Unit.</th>
                                    <th className="prop-th">Preço Unit.</th>
                                    <th className="prop-th">Total</th>
                                    <th className="prop-th">% Peso</th>
                                    <th className="prop-th" style={{ width: '50px' }}>Ref.</th>
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
                                                    <span onClick={() => p.setEditingItemId(item.id)} style={{ cursor: 'pointer' }} title="Clique para editar">
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
                                                {isEditing ? <input type="number" value={item.discountPercentage || 0} onChange={e => p.updateItem(item.id, 'discountPercentage', parseFloat(e.target.value) || 0)} className="prop-input" style={{ width: '50px', textAlign: 'center' }} step="0.1" /> : (item.discountPercentage ? `${item.discountPercentage}%` : '-')}
                                            </td>
                                            <td className="prop-td-center">
                                                {isEditing ? <input type="number" value={item.unitCost} onChange={e => p.updateItem(item.id, 'unitCost', parseFloat(e.target.value) || 0)} className="prop-input" style={{ width: '90px', textAlign: 'right' }} step="0.01" /> : fmt(item.unitCost)}
                                            </td>
                                            <td className="prop-td-center" style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{fmt(item.unitPrice)}</td>
                                            <td className="prop-td-center" style={{ fontWeight: 700 }}>{fmt(item.totalPrice)}</td>
                                            <td className="prop-td-center" style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                                                {p.total > 0 ? ((item.totalPrice / p.total) * 100).toFixed(1) + '%' : '0%'}
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
                                        <td colSpan={9} style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-base)' }}>
                                            <Sparkles size={32} color="var(--color-text-tertiary)" style={{ marginBottom: '8px' }} /><br />
                                            Nenhum item na proposta. Use o botão <strong>"Preencher com IA"</strong> para extrair os itens automaticamente do edital.
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
                                minWidth: '280px', padding: 'var(--space-4) var(--space-5)', borderRadius: 'var(--radius-lg)',
                                background: 'linear-gradient(135deg, rgba(37,99,235,0.04), rgba(139,92,246,0.04))',
                                border: '1px solid rgba(37,99,235,0.15)',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
                                    <span style={{ color: 'var(--color-text-secondary)' }}>Subtotal (custo)</span>
                                    <span style={{ fontWeight: 500 }}>{fmt(p.subtotal)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
                                    <span style={{ color: 'var(--color-text-secondary)' }}>Status Arredondamento</span>
                                    <span style={{ fontWeight: 500 }}>{p.roundingMode === 'ROUND' ? 'Arredondar' : 'Truncar'}</span>
                                </div>
                                <div style={{
                                    display: 'flex', justifyContent: 'space-between',
                                    borderTop: '2px solid var(--color-border)', paddingTop: '8px', marginTop: '4px',
                                    fontSize: '1.1rem', fontWeight: 800, color: 'var(--color-primary)',
                                }}>
                                    <span>TOTAL GLOBAL</span>
                                    <span>{fmt(p.total)}</span>
                                </div>
                                {p.selectedBidding && p.selectedBidding.estimatedValue > 0 && (
                                    <div style={{
                                        marginTop: '8px', fontSize: '0.75rem',
                                        color: p.total > p.selectedBidding.estimatedValue ? 'var(--color-danger)' : 'var(--color-success)',
                                        fontWeight: 600, textAlign: 'right',
                                    }}>
                                        {p.total > p.selectedBidding.estimatedValue
                                            ? `⚠ Acima do estimado (${fmt(p.selectedBidding.estimatedValue)})`
                                            : `✓ Abaixo do estimado (${fmt(p.selectedBidding.estimatedValue)})`
                                        }
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Letter Tab ── */}
            {p.activeTab === 'letter' && (
                <div className="card" style={{ padding: 'var(--space-6)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                        <div>
                            <h3 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                <FileText size={18} color="var(--color-primary)" /> Texto Principal da Carta
                            </h3>
                            <span style={{ fontSize: 'var(--text-md)', color: 'var(--color-text-tertiary)' }}>Recomendamos pedir para a IA escrever o texto formal baseado no edital e nos itens.</span>
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                            <button className="btn btn-outline" onClick={p.handleSaveLetter} disabled={p.isSaving}
                                style={{ padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius-lg)', fontSize: 'var(--text-md)' }}>
                                {p.isSaving ? <Loader2 size={16} className="spin" /> : <Save size={16} />} Salvar Rascunho
                            </button>
                            <button className="btn" onClick={p.handleGenerateLetter} disabled={p.isLetterLoading} style={{
                                padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius-lg)', fontSize: 'var(--text-md)',
                                background: 'linear-gradient(135deg, var(--color-ai), var(--color-primary))', color: 'white', border: 'none',
                                display: 'flex', alignItems: 'center', gap: 'var(--space-2)'
                            }}>
                                {p.isLetterLoading ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                                Gerar com IA
                            </button>
                        </div>
                    </div>

                    {/* Proposal Configs */}
                    <div style={{
                        background: 'var(--color-primary-light)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                        border: '1px solid rgba(37, 99, 235, 0.1)', marginBottom: 'var(--space-4)',
                        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-5)'
                    }}>
                        <div>
                            <label className="form-label">Validade da Proposta (dias)</label>
                            <input type="number" value={p.validityDays} onChange={e => p.setValidityDays(parseInt(e.target.value) || 60)} onBlur={p.handleSaveConfig} className="prop-input" />
                        </div>
                        <div>
                            <label className="form-label">Modelo de Assinatura</label>
                            <select value={p.signatureMode} onChange={e => { p.setSignatureMode(e.target.value as 'LEGAL' | 'TECH' | 'BOTH'); setTimeout(p.handleSaveConfig, 100); }}
                                className="prop-input" style={{ padding: '6px 8px' }}>
                                <option value="LEGAL">Representante Legal</option>
                                <option value="TECH">Responsável Técnico</option>
                                <option value="BOTH">Ambos</option>
                            </select>
                        </div>
                    </div>

                    {/* Image Uploads UI */}
                    <div style={{
                        background: 'var(--color-primary-light)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                        border: '1px solid rgba(37, 99, 235, 0.1)', marginBottom: 'var(--space-4)',
                        display: 'flex', flexDirection: 'column', gap: 'var(--space-4)'
                    }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)' }}>
                            <div>
                                <span className="form-label">Cabeçalho (Timbrado Topo)</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                    <input type="file" accept="image/*" onChange={e => p.handleImageUpload(e, p.setHeaderImage)} style={{ fontSize: '0.75rem', flex: 1 }} />
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <span style={{ fontSize: '0.7rem' }}>Alt:</span>
                                        <input type="number" value={p.headerImageHeight} onChange={e => p.setHeaderImageHeight(Number(e.target.value))} style={{ width: '50px', padding: '2px', fontSize: '0.75rem' }} />
                                    </div>
                                    {p.headerImage && <button type="button" onClick={() => p.setHeaderImage('')} style={{ fontSize: 'var(--text-sm)', color: 'var(--color-danger)', background: 'none', border: 'none', cursor: 'pointer' }}>Remover</button>}
                                </div>
                                {p.headerImage && (
                                    <div style={{ marginTop: 'var(--space-3)', border: '1px dashed var(--color-border)', padding: '4px', borderRadius: 'var(--radius-sm)', maxHeight: '100px', overflow: 'hidden', background: 'white' }}>
                                        <img src={p.headerImage} alt="Header Preview" style={{ width: '100%', height: 'auto', maxHeight: '90px', objectFit: 'contain' }} />
                                    </div>
                                )}
                            </div>
                            <div>
                                <span className="form-label">Rodapé (Timbrado Base)</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                    <input type="file" accept="image/*" onChange={e => p.handleImageUpload(e, p.setFooterImage)} style={{ fontSize: '0.75rem', flex: 1 }} />
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <span style={{ fontSize: '0.7rem' }}>Alt:</span>
                                        <input type="number" value={p.footerImageHeight} onChange={e => p.setFooterImageHeight(Number(e.target.value))} style={{ width: '50px', padding: '2px', fontSize: '0.75rem' }} />
                                    </div>
                                    {p.footerImage && <button type="button" onClick={() => p.setFooterImage('')} style={{ fontSize: 'var(--text-sm)', color: 'var(--color-danger)', background: 'none', border: 'none', cursor: 'pointer' }}>Remover</button>}
                                </div>
                                {p.footerImage && (
                                    <div style={{ marginTop: 'var(--space-3)', border: '1px dashed var(--color-border)', padding: '4px', borderRadius: 'var(--radius-sm)', maxHeight: '80px', overflow: 'hidden', background: 'white' }}>
                                        <img src={p.footerImage} alt="Footer Preview" style={{ width: '100%', height: 'auto', maxHeight: '70px', objectFit: 'contain' }} />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div style={{ borderTop: '1px solid rgba(37, 99, 235, 0.1)', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                            <button onClick={p.handleSaveCompanyTemplate} disabled={p.isSavingTemplate || !p.selectedCompanyId} style={{
                                padding: '6px var(--space-4)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-md)', fontWeight: 'var(--font-semibold)',
                                background: 'var(--color-bg-base)', border: '1px solid var(--color-primary)',
                                color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer'
                            }}>
                                {p.isSavingTemplate ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                                Salvar como Padrão da Empresa
                            </button>
                        </div>
                    </div>

                    <textarea value={p.letterContent} onChange={e => p.setLetterContent(e.target.value)}
                        placeholder="Nenhuma carta gerada ainda. Clique em 'Gerar com IA' ou digite seu texto."
                        style={{
                            width: '100%', minHeight: '400px', padding: 'var(--space-4)',
                            borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)',
                            fontSize: 'var(--text-base)', lineHeight: 1.6, background: 'var(--color-bg-base)',
                            color: 'var(--color-text-primary)'
                        }}
                    />
                </div>
            )}

            {/* ── Empty State ── */}
            {!p.proposal && p.items.length === 0 && (
                <div className="card" style={{ textAlign: 'center', padding: 'var(--space-16)', color: 'var(--color-text-tertiary)' }}>
                    <DollarSign size={48} strokeWidth={1.5} style={{ marginBottom: 'var(--space-4)', opacity: 0.3 }} />
                    <h3 style={{ margin: '0 0 var(--space-2) 0', fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-xl)' }}>
                        Nenhuma proposta selecionada
                    </h3>
                    <p style={{ margin: 0, fontSize: 'var(--text-base)' }}>
                        Selecione uma licitação com análise IA e uma empresa para criar uma proposta de preços.
                    </p>
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
        </>
    );
}
