import React from 'react';
import { X, Search, Database, RefreshCw, CheckCircle2, AlertTriangle, Eye, HelpCircle } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

export function HelpToolsModal({ isOpen, onClose }: Props) {
    if (!isOpen) return null;

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15, 23, 42, 0.4)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1300,
                padding: 16,
            }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 16,
                width: 760,
                maxWidth: '95vw',
                maxHeight: '90vh',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.18)',
                animation: 'scaleUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            background: 'rgba(59, 130, 246, 0.08)',
                            borderRadius: 10,
                            padding: 8,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                            <HelpCircle size={20} color="var(--color-primary)" />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                                Guia das Ferramentas de Orçamento
                            </h3>
                            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-tertiary)' }}>
                                Entenda a diferença e o impacto de cada ação disponível no menu Ferramentas
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            padding: 6,
                            borderRadius: '50%',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            color: 'var(--color-text-tertiary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'background 0.15s, color 0.15s',
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background = 'var(--color-bg-base)';
                            e.currentTarget.style.color = 'var(--color-text-primary)';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = 'var(--color-text-tertiary)';
                        }}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div style={{
                    padding: '24px',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 24,
                    flex: 1,
                }}>
                    {/* Cards Container */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                        gap: 16,
                    }}>
                        {/* 1. Reauditar Preços */}
                        <div style={{
                            border: '1px solid var(--color-border)',
                            borderRadius: 12,
                            padding: 16,
                            background: 'var(--color-bg-surface)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 12,
                            position: 'relative',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ background: 'rgba(100, 116, 139, 0.08)', borderRadius: 8, padding: 6, display: 'flex', alignItems: 'center' }}>
                                    <Eye size={16} color="var(--color-text-secondary)" />
                                </div>
                                <span style={{
                                    fontSize: '0.62rem',
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    background: 'var(--color-bg-base)',
                                    color: 'var(--color-text-secondary)',
                                    padding: '2px 8px',
                                    borderRadius: 12,
                                    border: '1px solid var(--color-border)'
                                }}>
                                    Apenas Leitura
                                </span>
                            </div>
                            <div>
                                <h4 style={{ margin: '0 0 4px 0', fontSize: '0.88rem', fontWeight: 700 }}>Reauditar Preços</h4>
                                <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                                    Compara os preços atuais da sua planilha com os valores das tabelas oficiais de referência do projeto.
                                </p>
                            </div>
                            <div style={{
                                marginTop: 'auto',
                                paddingTop: 10,
                                borderTop: '1px dashed var(--color-border)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                                fontSize: '0.72rem',
                                color: 'var(--color-text-tertiary)',
                            }}>
                                <div><strong>O que muda:</strong> A coluna <em>Auditoria</em>.</div>
                                <div style={{ color: 'var(--color-success)', fontWeight: 600 }}>❌ NÃO altera nenhum valor de preço.</div>
                            </div>
                        </div>

                        {/* 2. Puxar do Hub */}
                        <div style={{
                            border: '1px solid var(--color-border)',
                            borderRadius: 12,
                            padding: 16,
                            background: 'var(--color-bg-surface)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 12,
                            position: 'relative',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ background: 'rgba(59, 130, 246, 0.08)', borderRadius: 8, padding: 6, display: 'flex', alignItems: 'center' }}>
                                    <Database size={16} color="var(--color-primary)" />
                                </div>
                                <span style={{
                                    fontSize: '0.62rem',
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    background: 'rgba(59, 130, 246, 0.08)',
                                    color: 'var(--color-primary)',
                                    padding: '2px 8px',
                                    borderRadius: 12,
                                }}>
                                    Altera Planilha
                                </span>
                            </div>
                            <div>
                                <h4 style={{ margin: '0 0 4px 0', fontSize: '0.88rem', fontWeight: 700 }}>Puxar Valores do Hub</h4>
                                <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                                    Busca os valores oficiais das bases de dados ativas e atualiza automaticamente todos os itens com códigos válidos.
                                </p>
                            </div>
                            <div style={{
                                marginTop: 'auto',
                                paddingTop: 10,
                                borderTop: '1px dashed var(--color-border)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                                fontSize: '0.72rem',
                                color: 'var(--color-text-tertiary)',
                            }}>
                                <div><strong>O que muda:</strong> Custos unitários e remove duplicatas.</div>
                                <div style={{ color: 'var(--color-primary)', fontWeight: 600 }}>⚠️ Sobrescreve preços com os oficiais.</div>
                            </div>
                        </div>

                        {/* 3. Reconciliar Preços */}
                        <div style={{
                            border: '1px solid var(--color-border)',
                            borderRadius: 12,
                            padding: 16,
                            background: 'var(--color-bg-surface)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 12,
                            position: 'relative',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ background: 'rgba(16, 185, 129, 0.08)', borderRadius: 8, padding: 6, display: 'flex', alignItems: 'center' }}>
                                    <RefreshCw size={16} color="#10b981" />
                                </div>
                                <span style={{
                                    fontSize: '0.62rem',
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    background: 'rgba(16, 185, 129, 0.08)',
                                    color: '#10b981',
                                    padding: '2px 8px',
                                    borderRadius: 12,
                                }}>
                                    Alinha CPU
                                </span>
                            </div>
                            <div>
                                <h4 style={{ margin: '0 0 4px 0', fontSize: '0.88rem', fontWeight: 700 }}>Reconciliar Preços</h4>
                                <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                                    Sincroniza o custo unitário do item pai na planilha com o custo total detalhado de sua respectiva composição (CPU).
                                </p>
                            </div>
                            <div style={{
                                marginTop: 'auto',
                                paddingTop: 10,
                                borderTop: '1px dashed var(--color-border)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                                fontSize: '0.72rem',
                                color: 'var(--color-text-tertiary)',
                            }}>
                                <div><strong>O que muda:</strong> Custos de itens pai com CPUs editadas.</div>
                                <div style={{ color: '#10b981', fontWeight: 600 }}>⚙️ Garante a integridade matemática (Pai = CPU).</div>
                            </div>
                        </div>
                    </div>

                    {/* Comparative Table */}
                    <div>
                        <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', fontWeight: 700 }}>Tabela Comparativa Rápida</h4>
                        <div style={{
                            border: '1px solid var(--color-border)',
                            borderRadius: 8,
                            overflow: 'hidden',
                        }}>
                            <table style={{
                                width: '100%',
                                borderCollapse: 'collapse',
                                fontSize: '0.78rem',
                                textAlign: 'left',
                            }}>
                                <thead>
                                    <tr style={{ background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)' }}>
                                        <th style={{ padding: '10px 12px', fontWeight: 700 }}>Ferramenta</th>
                                        <th style={{ padding: '10px 12px', fontWeight: 700 }}>Objetivo Principal</th>
                                        <th style={{ padding: '10px 12px', fontWeight: 700 }}>Altera Valores?</th>
                                        <th style={{ padding: '10px 12px', fontWeight: 700 }}>Quando Usar?</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={{ padding: '12px', fontWeight: 600 }}>Reauditar Preços</td>
                                        <td style={{ padding: '12px', color: 'var(--color-text-secondary)' }}>Verificar se preços coincidem com bases oficiais</td>
                                        <td style={{ padding: '12px', color: 'var(--color-text-tertiary)' }}>❌ Não altera</td>
                                        <td style={{ padding: '12px', color: 'var(--color-text-secondary)' }}>Antes de fechar ou revisar para validação</td>
                                    </tr>
                                    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={{ padding: '12px', fontWeight: 600 }}>Puxar do Hub</td>
                                        <td style={{ padding: '12px', color: 'var(--color-text-secondary)' }}>Aplicar preços oficiais e remover duplicatas</td>
                                        <td style={{ padding: '12px', color: 'var(--color-primary)', fontWeight: 600 }}> Sobrescreve</td>
                                        <td style={{ padding: '12px', color: 'var(--color-text-secondary)' }}>Após importar planilha sem preços para auto-preenchimento</td>
                                    </tr>
                                    <tr>
                                        <td style={{ padding: '12px', fontWeight: 600 }}>Reconciliar Preços</td>
                                        <td style={{ padding: '12px', color: 'var(--color-text-secondary)' }}>Refletir soma da CPU no item da planilha</td>
                                        <td style={{ padding: '12px', color: '#10b981', fontWeight: 600 }}> Sobrescreve</td>
                                        <td style={{ padding: '12px', color: 'var(--color-text-secondary)' }}>Após modificar insumos/mão de obra na composição analítica</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Footer buttons */}
                <div style={{
                    padding: '16px 24px',
                    borderTop: '1px solid var(--color-border)',
                    background: 'var(--color-bg-base)',
                    display: 'flex',
                    justifyContent: 'flex-end',
                }}>
                    <button
                        onClick={onClose}
                        className="btn btn-primary"
                        style={{ padding: '8px 24px', fontSize: '0.82rem', fontWeight: 600 }}
                    >
                        Entendido
                    </button>
                </div>
            </div>
            {/* Embedded styles for animation */}
            <style>{`
                @keyframes scaleUp {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
            `}</style>
        </div>
    );
}
