import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../../config';
import { FileBadge, HardHat, Building2, Terminal, AlertTriangle, FileText, ChevronRight, PieChart as PieIcon, BarChart2 } from 'lucide-react';
import { BarChart as RBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart as RPieChart, Pie, Legend } from 'recharts';

interface StatsData {
    metrics: {
        totalCertificates: number;
        totalExperiences: number;
        totalCompanies: number;
        totalOracleJobs: number;
    };
    statsByCategory: { name: string; value: number }[];
    statsByCompany: { name: string; value: number }[];
    recentCertificates: {
        id: string;
        title: string;
        fileName: string;
        fileUrl: string;
        companyName: string;
        category: string;
        createdAt: string;
    }[];
}

interface Props {
    onNavigateToOracle: () => void;
}

export function InteligenciaDashboard({ onNavigateToOracle }: Props) {
    const [stats, setStats] = useState<StatsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchStats = async () => {
            setLoading(true);
            setError(null);
            try {
                const token = localStorage.getItem('token');
                const res = await axios.get(`${API_BASE_URL}/api/technical-certificates/stats`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                setStats(res.data);
            } catch (err: any) {
                console.error('[Dashboard Inteligencia] Failed to fetch stats:', err);
                setError('Não foi possível carregar as estatísticas do painel.');
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, []);

    const COLORS = ['#2563eb', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];

    const tooltipStyle = {
        borderRadius: '10px',
        border: 'none',
        boxShadow: '0 0 0 1px var(--color-border), 0 4px 16px rgba(0,0,0,0.12)',
        fontSize: '0.8rem',
        background: 'var(--color-bg-surface)',
        color: 'var(--color-text-primary)',
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '400px', color: 'var(--color-text-tertiary)' }}>
                <div style={{ textAlign: 'center' }}>
                    <div className="spinner mb-3" style={{ margin: '0 auto', width: '40px', height: '40px', border: '3px solid var(--color-border)', borderTop: '3px solid var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <p style={{ margin: 0 }}>Carregando dados do painel...</p>
                </div>
            </div>
        );
    }

    if (error || !stats) {
        return (
            <div className="info-panel info-panel--danger" style={{ margin: 'var(--space-6) 0', padding: 'var(--space-5)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                    <AlertTriangle size={24} />
                    <div>
                        <h4 style={{ margin: '0 0 4px 0', fontWeight: 'var(--font-bold)' }}>Erro ao carregar Dashboard</h4>
                        <p style={{ margin: 0, fontSize: 'var(--text-base)', opacity: 0.9 }}>{error || 'Ocorreu um erro desconhecido.'}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', paddingBottom: 'var(--space-8)' }}>
            
            {/* Header / Boas-vindas */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'linear-gradient(135deg, var(--color-bg-surface) 0%, rgba(37,99,235,0.03) 60%, rgba(139,92,246,0.02) 100%)',
                padding: 'var(--space-5) var(--space-6)',
                borderRadius: 'var(--radius-xl)',
                boxShadow: '0 0 0 1px rgba(37,99,235,0.12), 0 2px 12px rgba(37,99,235,0.06)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                    <div style={{
                        width: 44, height: 44, borderRadius: 'var(--radius-lg)',
                        background: 'linear-gradient(135deg, rgba(37,99,235,0.12), rgba(99,102,241,0.08))',
                        boxShadow: '0 0 0 1px rgba(37,99,235,0.2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                    }}>
                        <FileBadge size={20} color="var(--color-primary)" />
                    </div>
                    <div>
                        <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1.1 }}>
                            Dashboard de Inteligência
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                            Visão consolidada do acervo técnico e produtividade das análises do Oráculo.
                        </div>
                    </div>
                </div>

                <button onClick={onNavigateToOracle} className="btn btn-primary" style={{ height: '40px', fontWeight: 'var(--font-bold)', padding: '0 var(--space-4)' }}>
                    Acessar Oráculo Técnico <ChevronRight size={16} />
                </button>
            </div>

            {/* Grid de Cards de Métricas */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
                <KpiCard
                    label="Atestados Técnicos"
                    value={stats.metrics.totalCertificates}
                    icon={<FileBadge size={18} color="var(--color-primary)" />}
                    iconBg="rgba(37,99,235,0.08)"
                    iconBorder="rgba(37,99,235,0.15)"
                    borderColor="rgba(37,99,235,0.12)"
                    shadowColor="rgba(37,99,235,0.03)"
                />
                <KpiCard
                    label="Experiências Catalogadas"
                    value={stats.metrics.totalExperiences}
                    icon={<HardHat size={18} color="#22c55e" />}
                    iconBg="rgba(34,197,94,0.08)"
                    iconBorder="rgba(34,197,94,0.15)"
                    borderColor="rgba(34,197,94,0.12)"
                    shadowColor="rgba(34,197,94,0.03)"
                />
                <KpiCard
                    label="Empresas Mapeadas"
                    value={stats.metrics.totalCompanies}
                    icon={<Building2 size={18} color="#f59e0b" />}
                    iconBg="rgba(245,158,11,0.08)"
                    iconBorder="rgba(245,158,11,0.15)"
                    borderColor="rgba(245,158,11,0.12)"
                    shadowColor="rgba(245,158,11,0.03)"
                />
                <KpiCard
                    label="Consultas do Oráculo"
                    value={stats.metrics.totalOracleJobs}
                    icon={<Terminal size={18} color="#8b5cf6" />}
                    iconBg="rgba(139,92,246,0.08)"
                    iconBorder="rgba(139,92,246,0.15)"
                    borderColor="rgba(139,92,246,0.12)"
                    shadowColor="rgba(139,92,246,0.03)"
                />
            </div>

            {/* Separador e Seção Gráfica */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 14px', borderRadius: 9999,
                    background: 'var(--color-bg-surface)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)',
                    fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.1em', color: 'var(--color-text-tertiary)',
                }}>
                    <BarChart2 size={11} />
                    Mapeamento Visual
                </div>
                <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
            </div>

            {/* Gráficos */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 'var(--space-5)' }}>
                {/* Gráfico 1: Atestados por Categoria */}
                <div style={{
                    borderRadius: 'var(--radius-xl)',
                    background: 'var(--color-bg-surface)',
                    boxShadow: '0 0 0 1px var(--color-border), 0 2px 12px rgba(0,0,0,0.04)',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                        padding: 'var(--space-4) var(--space-5)',
                        borderBottom: '1px solid var(--color-border)',
                        background: 'linear-gradient(135deg, rgba(37,99,235,0.02), transparent)',
                    }}>
                        <PieIcon size={16} color="var(--color-primary)" />
                        <div>
                            <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                                Atestados por Categoria
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)', marginTop: 1 }}>
                                Proporção por tipo de atividade técnica
                            </div>
                        </div>
                    </div>
                    <div style={{ padding: 'var(--space-5)', height: 280, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        {stats.statsByCategory.length === 0 ? (
                            <div style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>Sem dados suficientes para exibir.</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <RPieChart>
                                    <Pie
                                        data={stats.statsByCategory}
                                        cx="50%" cy="45%"
                                        innerRadius={65}
                                        outerRadius={90}
                                        paddingAngle={3}
                                        dataKey="value"
                                        strokeWidth={2}
                                    >
                                        {stats.statsByCategory.map((_, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="var(--color-bg-surface)" />
                                        ))}
                                    </Pie>
                                    <Tooltip contentStyle={tooltipStyle} />
                                    <Legend
                                        iconType="circle" iconSize={8}
                                        wrapperStyle={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', paddingTop: 8 }}
                                    />
                                </RPieChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                {/* Gráfico 2: Atestados por Empresa */}
                <div style={{
                    borderRadius: 'var(--radius-xl)',
                    background: 'var(--color-bg-surface)',
                    boxShadow: '0 0 0 1px var(--color-border), 0 2px 12px rgba(0,0,0,0.04)',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                        padding: 'var(--space-4) var(--space-5)',
                        borderBottom: '1px solid var(--color-border)',
                        background: 'linear-gradient(135deg, rgba(37,99,235,0.02), transparent)',
                    }}>
                        <BarChart2 size={16} color="var(--color-primary)" />
                        <div>
                            <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                                Atestados por Empresa
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)', marginTop: 1 }}>
                                Volume de certificados por empresa cadastrada
                            </div>
                        </div>
                    </div>
                    <div style={{ padding: 'var(--space-5)', height: 280 }}>
                        {stats.statsByCompany.length === 0 ? (
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>
                                Sem dados suficientes para exibir.
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <RBarChart data={stats.statsByCompany.slice(0, 5)} layout="vertical" margin={{ left: 10, right: 20, top: 10, bottom: 10 }}>
                                    <CartesianGrid strokeDasharray="2 4" horizontal={false} stroke="var(--color-border)" />
                                    <XAxis type="number" hide />
                                    <YAxis
                                        dataKey="name" type="category" width={110}
                                        style={{ fontSize: '0.73rem' }}
                                        tick={{ fill: 'var(--color-text-secondary)' }}
                                    />
                                    <Tooltip
                                        cursor={{ fill: 'rgba(37,99,235,0.04)', rx: 4 }}
                                        contentStyle={tooltipStyle}
                                        formatter={(value) => [`${value ?? 0} atestados`, 'Quantidade'] as [string, string]}
                                    />
                                    <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16}>
                                        {stats.statsByCompany.slice(0, 5).map((_, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[(index + 1) % COLORS.length]} />
                                        ))}
                                    </Bar>
                                </RBarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>

            {/* Tabela de Lançamentos Recentes */}
            <div style={{
                borderRadius: 'var(--radius-xl)',
                background: 'var(--color-bg-surface)',
                boxShadow: '0 0 0 1px var(--color-border), 0 2px 12px rgba(0,0,0,0.04)',
                overflow: 'hidden',
            }}>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                    padding: 'var(--space-4) var(--space-5)',
                    borderBottom: '1px solid var(--color-border)',
                    background: 'linear-gradient(135deg, rgba(37,99,235,0.02), transparent)',
                }}>
                    <FileText size={16} color="var(--color-primary)" />
                    <div>
                        <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                            Últimos Atestados Adicionados
                        </div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)', marginTop: 1 }}>
                            Histórico dos últimos certificados importados no sistema
                        </div>
                    </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table className="table" style={{ width: '100%', borderCollapse: 'collapse', margin: 0 }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
                                <th style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--color-text-secondary)', textAlign: 'left', fontWeight: 'var(--font-bold)' }}>Título</th>
                                <th style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--color-text-secondary)', textAlign: 'left', fontWeight: 'var(--font-bold)' }}>Empresa</th>
                                <th style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--color-text-secondary)', textAlign: 'left', fontWeight: 'var(--font-bold)' }}>Categoria</th>
                                <th style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--color-text-secondary)', textAlign: 'left', fontWeight: 'var(--font-bold)' }}>Data Cadastro</th>
                                <th style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--color-text-secondary)', textAlign: 'center', fontWeight: 'var(--font-bold)', width: '80px' }}>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.recentCertificates.length === 0 ? (
                                <tr>
                                    <td colSpan={5} style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>
                                        Nenhum atestado cadastrado no momento.
                                    </td>
                                </tr>
                            ) : (
                                stats.recentCertificates.map(cert => (
                                    <tr key={cert.id} style={{ borderBottom: '1px solid var(--color-border)', transition: 'background 0.2s' }}>
                                        <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-base)', color: 'var(--color-text-primary)', fontWeight: 500 }}>
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span>{cert.title}</span>
                                                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>{cert.fileName}</span>
                                            </div>
                                        </td>
                                        <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-base)', color: 'var(--color-text-secondary)' }}>
                                            {cert.companyName}
                                        </td>
                                        <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-base)' }}>
                                            <span style={{
                                                padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600,
                                                background: 'rgba(37,99,235,0.06)', color: 'var(--color-primary)', border: '1px solid rgba(37,99,235,0.12)'
                                            }}>
                                                {cert.category}
                                            </span>
                                        </td>
                                        <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-base)', color: 'var(--color-text-tertiary)' }}>
                                            {new Date(cert.createdAt).toLocaleDateString('pt-BR')}
                                        </td>
                                        <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'center' }}>
                                            <a href={cert.fileUrl} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 'var(--text-sm)', height: '28px', minWidth: 'auto' }} title="Visualizar Arquivo">
                                                Visualizar
                                            </a>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    );
}

// ── KpiCard Interno ──
function KpiCard({
    label, value, icon, iconBg, iconBorder, borderColor, shadowColor
}: {
    label: string;
    value: number;
    icon: React.ReactNode;
    iconBg: string;
    iconBorder: string;
    borderColor: string;
    shadowColor: string;
}) {
    return (
        <div style={{
            padding: 'var(--space-5)', borderRadius: 'var(--radius-xl)',
            background: 'var(--color-bg-surface)',
            boxShadow: `0 0 0 1px ${borderColor}, 0 2px 12px ${shadowColor}`,
            display: 'flex', flexDirection: 'column',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)' }}>
                    {label}
                </div>
                <div style={{
                    width: 30, height: 30, borderRadius: 'var(--radius-md)',
                    background: iconBg, border: 'none', boxShadow: `0 0 0 1px ${iconBorder}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                    {icon}
                </div>
            </div>
            <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1, letterSpacing: '-0.03em' }}>
                {value}
            </div>
        </div>
    );
}
