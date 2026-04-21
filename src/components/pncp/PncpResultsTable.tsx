import React, { useState, useCallback } from 'react';
import { Loader2, Star, Bell, Search, MapPin, ExternalLink, Brain, Trash2, CheckCircle2, List, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { normalizeModality } from '../../utils/normalizeModality';
import type { PncpChildProps } from './types';
import { API_BASE_URL } from '../../config';

const LOADING_PHRASES = [
    'Consultando Banco de Licitações...',
    'Aplicando cruzamento de filtros avançados...',
    'Buscando os editais mais aderentes...',
    'Calculando estimativas financeiras em tempo real...',
    'Sincronizando com a base oficial do PNCP...',
    'Organizando prazos e modalidades...',
    'Quase lá! Montando os resultados da busca...'
];

function RotatingLoadingMessage({ isFoundTab }: { isFoundTab: boolean }) {
    const [index, setIndex] = React.useState(0);
    const [fade, setFade] = React.useState(true);
    
    React.useEffect(() => {
        if (isFoundTab) return;
        
        if (index >= LOADING_PHRASES.length - 1) {
            return; // Stop at the last phrase
        }

        const timer = setTimeout(() => {
            setFade(false);
            setTimeout(() => {
                setIndex((prev) => prev + 1);
                setFade(true);
            }, 300);
        }, 2800);
        
        return () => clearTimeout(timer);
    }, [index, isFoundTab]);

    if (isFoundTab) return <span>Carregando oportunidades...</span>;
    
    return (
        <span style={{ 
            transition: 'opacity 0.3s ease',
            opacity: fade ? 1 : 0,
            display: 'inline-block' 
        }}>
            {LOADING_PHRASES[index]}
        </span>
    );
}

/**
 * Formats a date string into a human-readable Brazilian Portuguese label.
 * Today → "Hoje, 18 de Abril"
 * Yesterday → "Ontem, 17 de Abril"
 * This week → "Terça-feira, 15 de Abril"
 * Older → "10 de Abril de 2026"
 */
function formatDateGroupLabel(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const itemDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.floor((today.getTime() - itemDate.getTime()) / 86400000);
    
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const dayOfMonth = date.getDate();
    const monthName = months[date.getMonth()];
    const year = date.getFullYear();
    
    if (diffDays === 0) return `Hoje, ${dayOfMonth} de ${monthName}`;
    if (diffDays === 1) return `Ontem, ${dayOfMonth} de ${monthName}`;
    if (diffDays <= 6) {
        const weekdays = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
        return `${weekdays[date.getDay()]}, ${dayOfMonth} de ${monthName}`;
    }
    return `${dayOfMonth} de ${monthName} de ${year}`;
}

/** Returns a YYYY-MM-DD key for date grouping */
function toDateKey(dateStr: string): string {
    try {
        const d = new Date(dateStr);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } catch {
        return 'unknown';
    }
}

/**
 * Extracts CNPJ, ano, and sequencial from a pncpId or link_sistema.
 * pncpId formats: "12345678901234-1-000023/2026" or "12345678901234-2026-23"
 * link_sistema: "https://pncp.gov.br/app/editais/12345678901234/2026/23"
 */
function extractPncpParts(item: any): { cnpj: string; ano: string; seq: string } | null {
    // Try from direct fields first
    if (item.orgao_cnpj && item.ano && item.numero_sequencial) {
        return { cnpj: item.orgao_cnpj, ano: item.ano, seq: item.numero_sequencial };
    }
    
    // Try from link_sistema: https://pncp.gov.br/app/editais/CNPJ/ANO/SEQ
    if (item.link_sistema) {
        const linkMatch = item.link_sistema.match(/editais\/(\d{11,14})\/(\d{4})\/(\d+)/);
        if (linkMatch) return { cnpj: linkMatch[1], ano: linkMatch[2], seq: linkMatch[3] };
    }
    
    // Try from id (pncpId): "CNPJ-X-SEQ/ANO" format
    const id = item.id || '';
    const m1 = id.match(/^(\d{11,14})-(\d+)-(\d+)\/(\d{4})$/);
    if (m1) return { cnpj: m1[1], ano: m1[4], seq: m1[3] };
    
    // Also try "CNPJ-ANO-SEQ" format
    const m2 = id.match(/^(\d{11,14})-(\d{4})-(\d+)$/);
    if (m2) return { cnpj: m2[1], ano: m2[2], seq: m2[3] };
    
    return null;
}

const ITEMS_PER_DATE_GROUP = 10;

export function PncpResultsTable({ p, items }: PncpChildProps) {
    const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
    const [itemDetails, setItemDetails] = useState<any[] | null>(null);
    const [loadingItems, setLoadingItems] = useState(false);
    const [itemError, setItemError] = useState('');
    const [slowLoad, setSlowLoad] = useState(false);

    // ── Date groups: expand/collapse + visible count per group ──
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [groupVisibleCounts, setGroupVisibleCounts] = useState<Record<string, number>>({});

    const toggleGroupCollapse = useCallback((dateKey: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(dateKey)) {
                next.delete(dateKey);
            } else {
                next.add(dateKey);
                // Fetch items for this date if not already loaded
                if (!p.dateItems?.[dateKey] && p.fetchDateItems) {
                    p.fetchDateItems(dateKey);
                }
            }
            return next;
        });
    }, [p.dateItems, p.fetchDateItems]);

    const showMoreInGroup = useCallback((dateKey: string) => {
        setGroupVisibleCounts(prev => {
            const currentVisible = prev[dateKey] || ITEMS_PER_DATE_GROUP;
            const loadedItems = p.dateItems?.[dateKey]?.length || 0;
            const newVisible = currentVisible + ITEMS_PER_DATE_GROUP;
            // If we need more items than loaded, fetch next page
            if (newVisible > loadedItems && p.fetchDateItems) {
                p.fetchDateItems(dateKey, true);
            }
            return { ...prev, [dateKey]: newVisible };
        });
    }, [p.dateItems, p.fetchDateItems]);

    /**
     * Map a scanner log item (from /scanner/opportunities) to the display format.
     * This was previously done in usePncpPage but now happens here since items are lazy-loaded.
     */
    const mapScannerItem = useCallback((opp: any) => ({
        id: opp.pncpId || opp.id,
        titulo: opp.titulo || 'Sem título',
        objeto: opp.objeto || '',
        orgao_nome: opp.orgaoNome || '',
        orgao_cnpj: opp.orgaoCnpj || '',
        ano: opp.anoCompra || '',
        numero_sequencial: opp.sequencialCompra || '',
        uf: opp.uf || '--',
        municipio: opp.municipio || '--',
        valor_estimado: opp.valorEstimado || 0,
        data_encerramento_proposta: opp.dataEncerramentoProposta || '',
        modalidade_nome: opp.modalidadeNome || '',
        link_sistema: opp.linkSistema || '',
        _scannerLogId: opp.id,
        _isViewed: opp.isViewed,
        _searchName: opp.searchName,
        _foundAt: opp.createdAt,
    }), []);

    const toggleItems = async (item: any) => {
        if (expandedItemId === item.id) {
            setExpandedItemId(null);
            setItemDetails(null);
            return;
        }

        setExpandedItemId(item.id);
        setItemDetails(null);
        setItemError('');
        setSlowLoad(false);

        // Extract CNPJ/ano/seq with fallback from pncpId or link_sistema
        const parts = extractPncpParts(item);
        if (!parts) {
            setItemError('Este processo não possui dados suficientes (CNPJ/ano/sequencial) para consultar itens no PNCP.');
            return;
        }
        
        // Enrich item with extracted parts for subsequent API calls
        item.orgao_cnpj = parts.cnpj;
        item.ano = parts.ano;
        item.numero_sequencial = parts.seq;

        setLoadingItems(true);

        // Show "slow" message after 3 seconds
        const slowTimer = setTimeout(() => setSlowLoad(true), 3000);

        try {
            const token = localStorage.getItem('token');
            
            // ══════════════════════════════════════════════════
            // STRATEGY: Local DB first → fallback to Gov.br
            // ══════════════════════════════════════════════════

            // Step 0: Check if result already has items from local search
            if (item.itens_preview && item.itens_preview.length > 0) {
                setItemDetails(item.itens_preview.map((it: any) => ({
                    itemNumber: it.numero || it.numeroItem || it.itemNumber,
                    description: it.descricao || it.description || '',
                    quantity: it.quantidade || it.quantity,
                    unit: it.unidade || it.unidadeMedida || it.unit || '',
                    unitValue: it.valorUnitario || it.valorUnitarioEstimado || it.unitValue || 0,
                    totalValue: it.valorTotal || it.totalValue || 0,
                })));
                return;
            }

            // Step 1: Try local database (instant)
            try {
                const localRes = await fetch(`${API_BASE_URL}/api/pncp/items-local/${item.orgao_cnpj}/${item.ano}/${item.numero_sequencial}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (localRes.ok) {
                    const localData = await localRes.json();
                    if (Array.isArray(localData) && localData.length > 0) {
                        // Normalize field names to match table renderer
                        setItemDetails(localData.map((it: any) => ({
                            itemNumber: it.numeroItem || it.itemNumber,
                            description: it.descricao || it.description || '',
                            quantity: it.quantidade || it.quantity,
                            unit: it.unidadeMedida || it.unit || '',
                            unitValue: it.valorUnitarioEstimado || it.valorUnitario || it.unitValue || 0,
                            totalValue: it.valorTotal || it.totalValue || 0,
                        })));
                        return;
                    }
                }
            } catch { /* local failed, fallback to Gov.br */ }

            // Step 2: Fallback to Gov.br API
            const params = new URLSearchParams({ cnpj: item.orgao_cnpj, ano: String(item.ano), seq: String(item.numero_sequencial) });
            let lastError = '';
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const res = await fetch(`${API_BASE_URL}/api/pncp/items?${params}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const data = await res.json();
                    if (!res.ok) {
                        lastError = data.error || 'Erro ao buscar itens';
                        if (res.status === 504 && attempt < 1) {
                            await new Promise(r => setTimeout(r, 1000));
                            continue;
                        }
                        setItemError(lastError);
                        return;
                    }
                    setItemDetails(data.items || []);
                    if (data.message) setItemError(data.message);
                    else if (data.items?.length === 0) setItemError('Nenhum item cadastrado no PNCP para este processo');
                    return;
                } catch (fetchErr: any) {
                    lastError = fetchErr?.message || 'Falha de conexão';
                    if (attempt < 1) {
                        await new Promise(r => setTimeout(r, 1000));
                        continue;
                    }
                }
            }
            setItemError('A API do Gov.br não respondeu após 2 tentativas. Tente novamente em alguns segundos.');
        } catch (error: any) {
            setItemError('Falha de conexão ao buscar itens. Verifique sua internet e tente novamente.');
        } finally {
            clearTimeout(slowTimer);
            setLoadingItems(false);
            setSlowLoad(false);
        }
    };

    // ═══ Shared Row Renderer (used by both Scanner groups and Search/Favorites flat lists) ═══
    const renderItemRow = (item: any, isFavorito: boolean, isOnKanban: boolean, isUnviewed: boolean, searchName: string | null, foundAt: string | null) => (
        <React.Fragment key={item._scannerLogId || item.id}>
        <tr style={{ 
            transition: 'background 0.15s',
            borderLeft: isUnviewed ? '3px solid var(--color-primary)' : 'none',
            background: isUnviewed ? 'rgba(37, 99, 235, 0.03)' : 'transparent',
        }}
            onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--color-bg-base)'}
            onMouseLeave={(e: any) => e.currentTarget.style.background = isUnviewed ? 'rgba(37, 99, 235, 0.03)' : 'transparent'}
        >
            <td style={{ paddingLeft: '24px', verticalAlign: 'top', paddingTop: '16px', paddingBottom: '16px' }}>
                <div style={{ fontWeight: 600, fontSize: '0.8125rem', lineHeight: '1.4' }}>{item.orgao_nome}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                    <MapPin size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '2px' }} /> {item.municipio} - {item.uf}
                </div>
                {searchName && (
                    <div style={{ fontSize: '0.6875rem', color: 'var(--color-primary)', marginTop: '4px', opacity: 0.8 }}>
                        <Search size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '2px' }} /> {searchName}
                        {foundAt && <> · {new Date(foundAt).toLocaleDateString('pt-BR')}</>}
                    </div>
                )}
            </td>
            <td style={{ verticalAlign: 'top', paddingTop: '16px', paddingBottom: '16px' }}>
                <div style={{ fontWeight: 600, fontSize: '0.8125rem', marginBottom: '4px', lineHeight: '1.3' }}>
                    {item.titulo}
                    {(p.activeTab === 'favorites' || p.activeTab === 'found') && isOnKanban && (
                        <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                            marginLeft: 'var(--space-2)', padding: '3px var(--space-2)',
                            background: 'var(--color-success-bg)', color: 'var(--color-success)',
                            borderRadius: 'var(--radius-lg)', fontSize: 'var(--text-sm)',
                            fontWeight: 'var(--font-bold)' as any, verticalAlign: 'middle'
                        }} title="Esta licitação já foi captada para o Kanban.">
                            <CheckCircle2 size={12} /> Salvo no Kanban
                        </span>
                    )}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: '1.4' }}>
                    {item.objeto}
                </div>
            </td>
            <td style={{ verticalAlign: 'top', paddingTop: '16px', whiteSpace: 'nowrap' }}>
                {item.modalidade_nome ? (
                    <span style={{
                        display: 'inline-block', padding: '3px var(--space-3)',
                        borderRadius: 'var(--radius-sm)', background: 'var(--color-primary-light)',
                        color: 'var(--color-primary)', fontSize: 'var(--text-sm)',
                        fontWeight: 'var(--font-semibold)' as any,
                    }}>{ normalizeModality(item.modalidade_nome) }</span>
                ) : (
                    <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>—</span>
                )}
            </td>
            <td style={{ whiteSpace: 'nowrap', verticalAlign: 'top', paddingTop: '16px' }}>
                {item.data_encerramento_proposta ? (() => {
                    const deadline = new Date(item.data_encerramento_proposta);
                    const msLeft = deadline.getTime() - Date.now();
                    const isExpired = msLeft < 0;
                    const deadlineColor = isExpired ? 'var(--color-text-tertiary)'
                        : msLeft < 3 * 86400000 ? 'var(--color-danger)'
                        : msLeft < 7 * 86400000 ? 'var(--color-warning)'
                        : 'var(--color-text-primary)';
                    return (<>
                        <div style={{ fontWeight: 700, fontSize: '0.8125rem', color: deadlineColor }}>
                            {deadline.toLocaleDateString('pt-BR')}
                            {isExpired && <span style={{ fontSize: '0.625rem', marginLeft: '4px', opacity: 0.7 }}>Vencido</span>}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>
                            {deadline.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    </>);
                })() : (
                    <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>—</span>
                )}
            </td>
            <td style={{ fontWeight: 700, verticalAlign: 'top', paddingTop: '16px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                {(() => {
                    const directVal = Number(item.valor_estimado) || 
                        Number((item as any).valorEstimado) ||
                        Number((item as any).valor_global) ||
                        Number((item as any).valorTotalEstimado) ||
                        Number((item as any).valorTotalHomologado) || 0;
                    const expandedVal = (expandedItemId === item.id && itemDetails) 
                        ? itemDetails.reduce((acc, it) => acc + (Number(it.totalValue) || (Number(it.unitValue) * Number(it.quantity)) || 0), 0) : 0;
                    const previewVal = (item as any).itens_preview?.length > 0
                        ? (item as any).itens_preview.reduce((acc: number, it: any) => acc + (Number(it.valorTotal) || Number(it.totalValue) || (Number(it.valorUnitarioEstimado || it.valorUnitario || it.unitValue || 0) * Number(it.quantidade || it.quantity || 1)) || 0), 0) : 0;
                    const computedVal = directVal || expandedVal || previewVal;
                    return computedVal ? (
                        <span style={{ color: 'var(--color-success)' }}>
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(computedVal)}
                        </span>
                    ) : (
                        <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>N/D</span>
                    );
                })()}
            </td>
            <td style={{ paddingRight: '24px', verticalAlign: 'top', paddingTop: '14px', textAlign: 'right' }}>
                <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button className="btn btn-ghost" onClick={() => toggleItems(item)}
                        style={{ padding: '7px', borderRadius: 'var(--radius-md)', 
                            background: expandedItemId === item.id ? 'var(--color-bg-elevated)' : 'transparent',
                            color: expandedItemId === item.id ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                            border: expandedItemId === item.id ? '1px solid var(--color-border)' : '1px solid transparent'
                        }}
                        title="Ver itens da Licitação"
                    >
                        {expandedItemId === item.id ? <ChevronUp size={15} /> : <List size={15} />}
                    </button>
                    <button className="btn btn-ghost" onClick={() => p.toggleFavorito(item)}
                        style={{ padding: '7px', borderRadius: 'var(--radius-md)', color: isFavorito ? 'var(--color-warning)' : 'var(--color-text-tertiary)', background: isFavorito ? 'var(--color-warning-bg)' : 'transparent' }}
                        title={isFavorito ? "Remover dos Favoritos" : "Adicionar aos Favoritos"}
                    >
                        <Star size={15} fill={isFavorito ? "currentColor" : "none"} />
                    </button>
                    {isFavorito && (
                        <button className="btn btn-ghost" onClick={() => p.toggleFavorito(item)}
                            style={{ padding: '7px', borderRadius: 'var(--radius-md)', color: 'var(--color-danger)', background: 'var(--color-danger-bg)' }}
                            title="Excluir dos Favoritos"
                        ><Trash2 size={15} /></button>
                    )}
                    <button className="btn"
                        style={{
                            padding: '7px var(--space-3)', fontSize: 'var(--text-sm)', borderRadius: 'var(--radius-md)',
                            gap: '4px', whiteSpace: 'nowrap',
                            background: p.analyzingItemId === item.id ? 'linear-gradient(135deg, var(--color-ai), var(--color-primary))' : 'linear-gradient(135deg, var(--color-primary), var(--color-ai))',
                            color: 'white', border: 'none',
                            cursor: p.analyzingItemId ? 'not-allowed' : 'pointer',
                            opacity: (p.analyzingItemId && p.analyzingItemId !== item.id) ? 0.5 : 1,
                            boxShadow: '0 2px 8px rgba(99, 102, 241, 0.3)', transition: 'var(--transition-fast)'
                        }}
                        onClick={() => {
                            const parts = extractPncpParts(item);
                            p.handlePncpAiAnalyze({
                                ...item,
                                orgao_cnpj: parts?.cnpj || item.orgao_cnpj,
                                ano: parts?.ano || item.ano,
                                numero_sequencial: parts?.seq || item.numero_sequencial
                            });
                        }}
                        disabled={!!p.analyzingItemId}
                        title="Analisar edital com IA (busca PDFs do PNCP automaticamente)"
                    >
                        {p.analyzingItemId === item.id ? (<><Loader2 size={14} className="spinner" /> Enviando...</>) : (<><Brain size={14} /> Analisar com IA</>)}
                    </button>
                    <a href={item.link_sistema} target="_blank" rel="noreferrer" className="btn btn-ghost"
                        style={{ padding: '7px', borderRadius: 'var(--radius-md)' }} title="Abrir no PNCP"
                    ><ExternalLink size={15} /></a>
                </div>
            </td>
        </tr>
        {expandedItemId === item.id && (
            <tr style={{ background: 'var(--color-bg-base)' }}>
                <td colSpan={6} style={{ padding: 0 }}>
                    <div style={{ padding: '20px 24px', borderTop: '1px solid var(--color-border-subtle)', borderBottom: '1px solid var(--color-border)', boxShadow: 'inset 0 4px 6px -4px rgba(0,0,0,0.05)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h4 style={{ fontSize: '0.875rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <List size={16} color="var(--color-primary)" /> Itens da Licitação (Pré-visualização)
                            </h4>
                        </div>
                        {loadingItems ? (
                            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                                <Loader2 size={24} className="spinner" style={{ margin: '0 auto 12px', color: 'var(--color-primary)' }} />
                                <span style={{ fontSize: '0.875rem', display: 'block' }}>
                                    {slowLoad ? 'A API do Gov.br está demorando para responder... Aguarde mais um momento.' : 'Buscando itens no Gov.br...'}
                                </span>
                            </div>
                        ) : itemError ? (
                            <div style={{ padding: '20px', textAlign: 'center', background: 'var(--color-bg-surface-elevated)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
                                {itemError}
                            </div>
                        ) : itemDetails && itemDetails.length > 0 ? (
                            <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--color-bg-surface)', maxHeight: '350px', overflowY: 'auto' }}>
                                <table className="table" style={{ width: '100%', fontSize: '0.75rem' }}>
                                    <thead style={{ background: 'var(--color-bg-subtle)' }}>
                                        <tr>
                                            <th style={{ padding: '10px 16px', width: '5%', textAlign: 'center' }}>Item</th>
                                            <th style={{ padding: '10px 16px', width: '55%' }}>Descrição</th>
                                            <th style={{ padding: '10px 16px', width: '10%', textAlign: 'right' }}>Qtd</th>
                                            <th style={{ padding: '10px 16px', width: '15%', textAlign: 'right' }}>Valor Unit. Estimado</th>
                                            <th style={{ padding: '10px 16px', width: '15%', textAlign: 'right' }}>Valor Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {itemDetails.map((det, idx) => (
                                            <tr key={idx} style={{ borderBottom: idx === itemDetails.length - 1 ? 'none' : '1px solid var(--color-border-subtle)' }}>
                                                <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: 'var(--color-text-secondary)' }}>{det.itemNumber}</td>
                                                <td style={{ padding: '12px 16px', lineHeight: '1.4' }}>{det.description}</td>
                                                <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 500 }}>{det.quantity}</td>
                                                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(det.unitValue || 0)}
                                                </td>
                                                <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: 'var(--color-success)' }}>
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(det.totalValue || 0)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : null}
                    </div>
                </td>
            </tr>
        )}
        </React.Fragment>
    );

    return (
        <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-xl)', border: 'none', boxShadow: 'var(--shadow-sm), 0 0 0 1px var(--color-border)', overflow: 'hidden' }}>
            <table className="table" style={{ width: '100%' }}>
                <thead>
                    <tr>
                        <th style={{ paddingLeft: '24px', width: '22%' }}>Órgão / Localidade</th>
                        <th style={{ width: '38%' }}>Objeto</th>
                        <th style={{ width: '12%' }}>Modalidade</th>
                        <th style={{ width: '10%' }}>Prazo Limite</th>
                        <th style={{ width: '8%', textAlign: 'right' }}>Valor Est.</th>
                        <th style={{ paddingRight: '24px', width: '10%', textAlign: 'right' }}>Ações</th>
                    </tr>
                </thead>
                <tbody>
                    {(p.loading || (p.activeTab === 'found' && p.scannerOpportunitiesLoading)) ? (
                        <tr>
                            <td colSpan={6} style={{ textAlign: 'center', padding: '60px' }}>
                                <Loader2 size={32} className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
                                <div style={{ marginTop: '12px', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
                                    <RotatingLoadingMessage isFoundTab={p.activeTab === 'found'} />
                                </div>
                            </td>
                        </tr>
                    ) : p.displayItems.length === 0 ? (
                        <tr>
                            <td colSpan={6} style={{ textAlign: 'center', padding: '60px', color: 'var(--color-text-tertiary)' }}>
                                {p.activeTab === 'favorites' ? <Star size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                                    : p.activeTab === 'found' ? <Bell size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                                    : <Search size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />}
                                <div style={{ fontSize: '1rem', fontWeight: 500 }}>
                                    {p.activeTab === 'favorites' ? 'Nenhum edital nos favoritos'
                                        : p.activeTab === 'found' ? 'Nenhuma oportunidade encontrada pelo scanner'
                                        : !p.hasSearched ? 'Busque editais no PNCP'
                                        : 'Nenhum edital encontrado'}
                                </div>
                                <div style={{ fontSize: '0.8125rem', marginTop: '4px' }}>
                                    {p.activeTab === 'favorites' ? 'Clique na estrela para favoritar resultados.'
                                        : p.activeTab === 'found' ? 'Ative o scanner e aguarde a próxima varredura automática.'
                                        : !p.hasSearched ? 'Digite palavras-chave e clique em "Buscar", ou carregue uma pesquisa salva.'
                                        : 'Tente ajustar as palavras-chave ou filtros.'}
                                </div>
                            </td>
                        </tr>
                    ) : p.activeTab === 'found' && p.dateSummary && p.dateSummary.length > 0 ? (
                        /* ═══ Scanner: Summary-based Date Cards (all dates visible) ═══ */
                        p.dateSummary.flatMap((group: any) => {
                            const dateKey = group.date;
                            const isExpanded = expandedGroups.has(dateKey);
                            const rawItems = p.dateItems?.[dateKey] || [];
                            const mappedItems = rawItems.map(mapScannerItem);
                            const isLoadingDate = p.dateItemsLoading?.[dateKey] || false;
                            const visibleCount = groupVisibleCounts[dateKey] || ITEMS_PER_DATE_GROUP;
                            const visibleItems = isExpanded ? mappedItems.slice(0, visibleCount) : [];
                            const totalForDate = group.count;
                            const loadedCount = mappedItems.length;
                            const hasMoreToShow = isExpanded && loadedCount > visibleCount;
                            const hasMoreToLoad = isExpanded && loadedCount < totalForDate;
                            const hiddenLoaded = loadedCount - visibleCount;
                            const label = formatDateGroupLabel(dateKey + 'T12:00:00');

                            const headerRow = (
                                <tr key={`dg-${dateKey}`} style={{ background: 'none' }}>
                                    <td colSpan={6} style={{ padding: '0' }}>
                                        <div 
                                            onClick={() => toggleGroupCollapse(dateKey)}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '12px',
                                                padding: '14px 24px 10px',
                                                borderTop: '1px solid var(--color-border)',
                                                cursor: 'pointer',
                                                userSelect: 'none',
                                                transition: 'background 0.15s',
                                            }}
                                            onMouseEnter={(e: any) => e.currentTarget.style.background = 'rgba(37, 99, 235, 0.02)'}
                                            onMouseLeave={(e: any) => e.currentTarget.style.background = 'transparent'}
                                        >
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                padding: '5px 14px',
                                                background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.08), rgba(99, 102, 241, 0.06))',
                                                borderRadius: 'var(--radius-lg)',
                                                border: '1px solid rgba(37, 99, 235, 0.15)',
                                            }}>
                                                <Calendar size={14} style={{ color: 'var(--color-primary)', opacity: 0.8 }} />
                                                <span style={{
                                                    fontSize: '0.8125rem',
                                                    fontWeight: 600,
                                                    color: 'var(--color-primary)',
                                                    letterSpacing: '0.01em',
                                                }}>
                                                    {label}
                                                </span>
                                            </div>
                                            <span style={{
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                                color: 'var(--color-text-tertiary)',
                                                background: 'var(--color-bg-base)',
                                                padding: '2px 10px',
                                                borderRadius: '12px',
                                                border: '1px solid var(--color-border)',
                                            }}>
                                                {totalForDate} {totalForDate === 1 ? 'edital' : 'editais'}
                                            </span>
                                            {group.unread > 0 && (
                                                <span style={{
                                                    fontSize: '0.625rem',
                                                    fontWeight: 700,
                                                    color: '#fff',
                                                    background: 'var(--color-danger)',
                                                    padding: '1px 8px',
                                                    borderRadius: '9px',
                                                    minWidth: '18px',
                                                    textAlign: 'center',
                                                }}>
                                                    {group.unread} novo{group.unread !== 1 ? 's' : ''}
                                                </span>
                                            )}
                                            <div style={{
                                                flex: 1,
                                                height: '1px',
                                                background: 'linear-gradient(90deg, var(--color-border), transparent)',
                                            }} />
                                            {isExpanded ? (
                                                <ChevronUp size={16} style={{ color: 'var(--color-text-tertiary)', transition: 'transform 0.2s' }} />
                                            ) : (
                                                <ChevronDown size={16} style={{ color: 'var(--color-text-tertiary)', transition: 'transform 0.2s' }} />
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );

                            // Loading state for this date
                            const loadingRow = isExpanded && isLoadingDate && loadedCount === 0 ? (
                                <tr key={`loading-${dateKey}`} style={{ background: 'none' }}>
                                    <td colSpan={6} style={{ textAlign: 'center', padding: '30px' }}>
                                        <Loader2 size={20} className="spinner" style={{ margin: '0 auto 8px', color: 'var(--color-primary)' }} />
                                        <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)' }}>Carregando editais...</div>
                                    </td>
                                </tr>
                            ) : null;

                            const itemRows = visibleItems.flatMap((item: any) => {
                                const isFavorito = p.favoritos.some(f => f.id === item.id);
                                const isOnKanban = items.some(proc => proc.link && item.link_sistema && proc.link.includes(item.link_sistema));
                                const isUnviewed = (item as any)._isViewed === false;
                                const searchName = (item as any)._searchName || null;
                                const foundAt = (item as any)._foundAt || null;
                                return [renderItemRow(item, isFavorito, isOnKanban, isUnviewed, searchName, foundAt)];
                            });

                            // "Ver mais" button — shows when there are more items to show (loaded or to load)
                            const showMoreRow = (hasMoreToShow || hasMoreToLoad) && isExpanded ? (
                                <tr key={`more-${dateKey}`} style={{ background: 'none' }}>
                                    <td colSpan={6} style={{ padding: '0', textAlign: 'center' }}>
                                        <button
                                            onClick={() => showMoreInGroup(dateKey)}
                                            disabled={isLoadingDate}
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                padding: '8px 20px',
                                                margin: '8px 0 12px',
                                                fontSize: '0.8125rem',
                                                fontWeight: 500,
                                                color: 'var(--color-primary)',
                                                background: 'rgba(37, 99, 235, 0.05)',
                                                border: '1px solid rgba(37, 99, 235, 0.15)',
                                                borderRadius: 'var(--radius-lg)',
                                                cursor: isLoadingDate ? 'wait' : 'pointer',
                                                transition: 'all 0.15s',
                                                opacity: isLoadingDate ? 0.6 : 1,
                                            }}
                                            onMouseEnter={(e: any) => { if (!isLoadingDate) { e.currentTarget.style.background = 'rgba(37, 99, 235, 0.1)'; e.currentTarget.style.borderColor = 'rgba(37, 99, 235, 0.3)'; }}}
                                            onMouseLeave={(e: any) => { e.currentTarget.style.background = 'rgba(37, 99, 235, 0.05)'; e.currentTarget.style.borderColor = 'rgba(37, 99, 235, 0.15)'; }}
                                        >
                                            {isLoadingDate ? (
                                                <><Loader2 size={14} className="spinner" /> Carregando...</>
                                            ) : (
                                                <><ChevronDown size={14} /> Ver mais {Math.min(hasMoreToShow ? hiddenLoaded : totalForDate - visibleCount, ITEMS_PER_DATE_GROUP)} de {totalForDate - visibleCount} restante{(totalForDate - visibleCount) !== 1 ? 's' : ''}</>
                                            )}
                                        </button>
                                    </td>
                                </tr>
                            ) : null;

                            return [headerRow, ...(loadingRow ? [loadingRow] : []), ...itemRows, ...(showMoreRow ? [showMoreRow] : [])];
                        })
                    ) : p.activeTab === 'found' ? (
                        /* ═══ Scanner: No results or loading ═══ */
                        <tr>
                            <td colSpan={6} style={{ textAlign: 'center', padding: '60px', color: 'var(--color-text-tertiary)' }}>
                                <Bell size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                                <div style={{ fontSize: '1rem', fontWeight: 500 }}>Nenhuma oportunidade encontrada pelo scanner</div>
                                <div style={{ fontSize: '0.8125rem', marginTop: '4px' }}>Ative o scanner e aguarde a próxima varredura automática.</div>
                            </td>
                        </tr>
                    ) : (
                        /* ═══ Search + Favorites: Flat Rendering ═══ */
                        p.displayItems.map((item) => {
                            const isFavorito = p.favoritos.some(f => f.id === item.id);
                            const isOnKanban = items.some(proc => proc.link && item.link_sistema && proc.link.includes(item.link_sistema));
                            return renderItemRow(item, isFavorito, isOnKanban, false, null, null);
                        })
                    )}
                </tbody>
            </table>

            {/* ═══ Pagination Controls ═══ */}
            {p.activeTab === 'search' && p.hasSearched && p.totalResults > 0 && (() => {
                const pageSize = 10;
                const totalPages = Math.ceil(p.totalResults / pageSize);
                return (
                    <div style={{
                        display: 'flex', justifyContent: 'center', alignItems: 'center',
                        gap: 'var(--space-4)', padding: 'var(--space-5)',
                        borderTop: '1px solid var(--color-border)',
                    }}>
                        <button
                            className="btn btn-ghost"
                            disabled={p.page <= 1 || p.loading}
                            onClick={() => p.setPage(p.page - 1)}
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 16px', fontSize: '0.875rem' }}
                        >
                            <ChevronLeft size={16} /> Anterior
                        </button>
                        <span style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            Página {p.page} de {totalPages} — {p.totalResults} resultados
                        </span>
                        <button
                            className="btn btn-ghost"
                            disabled={p.page >= totalPages || p.loading}
                            onClick={() => p.setPage(p.page + 1)}
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 16px', fontSize: '0.875rem' }}
                        >
                            Próxima <ChevronRight size={16} />
                        </button>
                    </div>
                );
            })()}

            {/* Paginator removed for 'found' tab — date cards handle pagination internally */}
        </div>
    );
}
