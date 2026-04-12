import { useState, useEffect, useRef } from 'react';
import { Search, FileText, Building2, Briefcase, CornerDownLeft, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../../config';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onNavigate: (route: string, context?: any) => void;
}

export function GlobalSearchModal({ isOpen, onClose, onNavigate }: Props) {
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<{ type: string; id: string; title: string; subtitle: string; icon: any }[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceTimeout = useRef<any>(null);

    // Focus input on open
    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setResults([]);
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    // Handle keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(prev => (prev < results.length - 1 ? prev + 1 : prev));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
            } else if (e.key === 'Enter' && results.length > 0) {
                e.preventDefault();
                handleSelect(results[selectedIndex]);
            } else if (e.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, results, selectedIndex]);

    // Debounced Search
    useEffect(() => {
        if (!query.trim()) {
            setResults([]);
            setLoading(false);
            return;
        }

        if (debounceTimeout.current) clearTimeout(debounceTimeout.current);

        setLoading(true);
        debounceTimeout.current = setTimeout(() => {
            performSearch(query);
        }, 400);

        return () => clearTimeout(debounceTimeout.current);
    }, [query]);

    const performSearch = async (searchTerm: string) => {
        try {
            const token = localStorage.getItem('token');
            const headers = { 'Authorization': `Bearer ${token}` };

            // Fetch biddings
            const resBiddings = await fetch(`${API_BASE_URL}/api/biddings`, { headers });
            let biddingResults: any[] = [];
            if (resBiddings.ok) {
                const data = await resBiddings.json();
                biddingResults = data.filter((b: any) => 
                    (b.editalNumber && b.editalNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
                    (b.organ && b.organ.toLowerCase().includes(searchTerm.toLowerCase())) ||
                    (b.object && b.object.toLowerCase().includes(searchTerm.toLowerCase())) ||
                    (b.uasg && b.uasg.toLowerCase().includes(searchTerm.toLowerCase()))
                ).map((b: any) => ({
                    type: 'bidding',
                    id: b.id,
                    title: `${b.organ} ${b.uasg ? `(UASG: ${b.uasg})` : ''}`,
                    subtitle: `Edital ${b.editalNumber} — ${b.object ? b.object.substring(0, 60) + '...' : ''}`,
                    icon: <Briefcase size={16} color="var(--color-primary)" />
                }));
            }

            // Fetch companies
            const resCompanies = await fetch(`${API_BASE_URL}/api/companies`, { headers });
            let companyResults: any[] = [];
            if (resCompanies.ok) {
                const data = await resCompanies.json();
                companyResults = data.filter((c: any) => 
                    (c.razaoSocial && c.razaoSocial.toLowerCase().includes(searchTerm.toLowerCase())) ||
                    (c.cnpj && c.cnpj.toLowerCase().includes(searchTerm.toLowerCase()))
                ).map((c: any) => ({
                    type: 'company',
                    id: c.id,
                    title: c.razaoSocial,
                    subtitle: `CNPJ: ${c.cnpj}`,
                    icon: <Building2 size={16} color="#10b981" />
                }));
            }

            // Static quick links
            const quickLinks = [
                { type: 'route', id: 'bidding', title: 'Adicionar Nova Licitação', subtitle: 'Ir para o Formulário de Cadastro', icon: <FileText size={16} /> },
                { type: 'route', id: 'opportunities', title: 'Adicionar Edital Manualmente', subtitle: 'Ir para Upload de Oportunidades', icon: <Search size={16} /> }
            ].filter(link => link.title.toLowerCase().includes(searchTerm.toLowerCase()));

            setResults([...quickLinks, ...biddingResults, ...companyResults].slice(0, 8)); // Max 8 results
            setSelectedIndex(0);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleSelect = (item: any) => {
        if (item.type === 'bidding') {
            onNavigate('bidding', { highlight: item.id });
        } else if (item.type === 'company') {
            onNavigate('companies');
        } else if (item.type === 'route') {
            onNavigate(item.id);
        }
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '15vh',
            backgroundColor: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)',
            animation: 'fadeIn 0.15s ease-out'
        }} onClick={onClose}>
            <div 
                style={{
                    background: 'var(--color-bg-surface)', 
                    width: '100%', maxWidth: '600px', 
                    borderRadius: 'var(--radius-xl)', 
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px var(--color-border)',
                    overflow: 'hidden',
                    transformOrigin: 'top',
                    animation: 'slideDownFade 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Search Input Area */}
                <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
                    <Search size={22} color="var(--color-text-tertiary)" style={{ flexShrink: 0 }} />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Buscar licitações, empresas ou pressione ↵"
                        style={{
                            flex: 1, border: 'none', background: 'transparent',
                            fontSize: '1.125rem', color: 'var(--color-text-primary)',
                            padding: '0 16px', outline: 'none'
                        }}
                    />
                    {loading && <Loader2 size={18} color="var(--color-primary)" className="spinner" />}
                    <div style={{ 
                        fontSize: '10px', fontWeight: 600, color: 'var(--color-text-tertiary)',
                        padding: '4px 6px', background: 'var(--color-bg-base)', borderRadius: '4px', border: '1px solid var(--color-border)',
                        marginLeft: '12px'
                    }}>
                        ESC
                    </div>
                </div>

                {/* Results Area */}
                <div style={{ maxHeight: '380px', overflowY: 'auto', padding: '12px' }}>
                    {query.trim().length === 0 ? (
                        <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                            <Search size={32} opacity={0.5} style={{ margin: '0 auto 12px' }} />
                            <p style={{ fontSize: '0.875rem' }}>O que você está procurando?</p>
                            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
                                <span style={{ fontSize: '11px', background: 'var(--color-bg-base)', padding: '2px 8px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>Licitações no Funil</span>
                                <span style={{ fontSize: '11px', background: 'var(--color-bg-base)', padding: '2px 8px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>Clientes Cadastrados</span>
                                <span style={{ fontSize: '11px', background: 'var(--color-bg-base)', padding: '2px 8px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>Ações Rápidas</span>
                            </div>
                        </div>
                    ) : results.length === 0 && !loading ? (
                        <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                            Nenhum resultado encontrado para "{query}"
                        </div>
                    ) : (
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {results.map((item, index) => {
                                const isSelected = index === selectedIndex;
                                return (
                                    <li 
                                        key={`${item.type}-${item.id}`}
                                        onClick={() => handleSelect(item)}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '16px',
                                            padding: '12px 16px', borderRadius: 'var(--radius-md)',
                                            background: isSelected ? 'var(--color-primary-light)' : 'transparent',
                                            cursor: 'pointer', transition: 'background 0.1s'
                                        }}
                                    >
                                        <div style={{
                                            width: 32, height: 32, borderRadius: 'var(--radius-md)',
                                            background: isSelected ? 'white' : 'var(--color-bg-base)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            boxShadow: isSelected ? '0 1px 3px rgba(0,0,0,0.1)' : '0 0 0 1px var(--color-border)',
                                            flexShrink: 0
                                        }}>
                                            {item.icon}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {item.title}
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: isSelected ? 'var(--color-primary)' : 'var(--color-text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                                                {item.subtitle}
                                            </div>
                                        </div>
                                        {isSelected && (
                                            <div style={{ display: 'flex', alignItems: 'center', color: 'var(--color-primary)' }}>
                                                <CornerDownLeft size={16} />
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                {/* Footer */}
                <div style={{ 
                    padding: '10px 16px', background: 'var(--color-bg-base)', borderTop: '1px solid var(--color-border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: 'var(--color-text-tertiary)'
                }}>
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <div style={{ padding: '2px 6px', background: 'var(--color-bg-surface)', borderRadius: '4px', border: '1px solid var(--color-border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>↑</div>
                            <div style={{ padding: '2px 6px', background: 'var(--color-bg-surface)', borderRadius: '4px', border: '1px solid var(--color-border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>↓</div>
                            Navegar
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <div style={{ padding: '2px 6px', background: 'var(--color-bg-surface)', borderRadius: '4px', border: '1px solid var(--color-border)', display: 'inline-flex', alignItems: 'center', justifyItems: 'center' }}>↵</div>
                            Selecionar
                        </span>
                    </div>
                </div>
            </div>
            
            <style>{`
                @keyframes slideDownFade {
                    from { opacity: 0; transform: translateY(-10px) scale(0.98); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
            `}</style>
        </div>
    );
}
