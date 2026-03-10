import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquare, Search, RefreshCw, Loader2, Satellite, Gavel, Building2, User, Bot } from 'lucide-react';
import { API_BASE_URL } from '../config';

type TabFilter = 'all' | 'unread' | 'important' | 'archived';

interface ChatMessage {
  id: string;
  messageId: string | null;
  content: string;
  detectedKeyword: string | null;
  authorType: string | null;
  authorCnpj: string | null;
  eventCategory: string | null;
  itemRef: string | null;
  captureSource: string | null;
  createdAt: string;
  status: string;
  biddingProcessId: string;
  biddingProcess?: {
    id: string;
    title: string;
    portal: string;
    modality: string;
    uasg: string | null;
    processNumber: string | null;
    processYear: string | null;
    companyId: string | null;
  };
}

interface ProcessGroup {
  processId: string;
  title: string;
  portal: string;
  modality: string;
  uasg: string | null;
  companyId: string | null;
  messages: ChatMessage[];
  lastMessageAt: string;
  unreadCount: number;
  isImportant: boolean;
  isArchived: boolean;
}

interface Props {
  companies: { id: string; name?: string; cnpj?: string; }[];
}

// ── Keyword highlight helper ──
function highlightKeywords(text: string, keyword: string | null) {
  if (!keyword) return text;
  const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} style={{ background: '#fef08a', padding: '1px 3px', borderRadius: '3px', fontWeight: 600 }}>{part}</mark>
      : part
  );
}

// ── Author icon helper ──
function AuthorIcon({ type }: { type: string | null }) {
  if (type === 'pregoeiro') return <Gavel size={14} />;
  if (type === 'sistema') return <Bot size={14} />;
  if (type === 'fornecedor') return <User size={14} />;
  return <MessageSquare size={14} />;
}

function authorLabel(type: string | null) {
  if (type === 'pregoeiro') return 'Pregoeiro';
  if (type === 'sistema') return 'Sistema';
  if (type === 'fornecedor') return 'Fornecedor';
  return 'Mensagem';
}

function authorColor(type: string | null) {
  if (type === 'pregoeiro') return { bg: 'rgba(37, 99, 235, 0.08)', border: 'rgba(37, 99, 235, 0.15)', text: '#2563eb' };
  if (type === 'sistema') return { bg: 'rgba(245, 158, 11, 0.08)', border: 'rgba(245, 158, 11, 0.15)', text: '#d97706' };
  if (type === 'fornecedor') return { bg: 'rgba(100, 116, 139, 0.06)', border: 'rgba(100, 116, 139, 0.12)', text: '#64748b' };
  return { bg: 'var(--color-bg-surface)', border: 'var(--color-border)', text: 'var(--color-text-secondary)' };
}

function portalBadge(portal: string) {
  const p = (portal || '').toLowerCase();
  if (p.includes('compras') || p.includes('cnet')) return { label: 'ComprasNet', color: '#059669', bg: 'rgba(5, 150, 105, 0.1)' };
  if (p.includes('pncp')) return { label: 'PNCP', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.08)' };
  if (p.includes('bll')) return { label: 'BLL', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.08)' };
  return { label: portal || 'Outro', color: '#64748b', bg: 'rgba(100, 116, 139, 0.06)' };
}

export function ChatMonitorPage({ companies }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const token = localStorage.getItem('token');
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // ── Fetch all messages ──
  const fetchMessages = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/chat-monitor/logs?limit=500`, { headers });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to fetch chat messages:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(() => fetchMessages(true), 15000); // Auto-refresh every 15s
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // ── Group messages by process ──
  const processGroups: ProcessGroup[] = (() => {
    const groupMap = new Map<string, ProcessGroup>();

    for (const msg of messages) {
      const pid = msg.biddingProcessId;
      if (!groupMap.has(pid)) {
        groupMap.set(pid, {
          processId: pid,
          title: msg.biddingProcess?.title || 'Processo desconhecido',
          portal: msg.biddingProcess?.portal || '',
          modality: msg.biddingProcess?.modality || '',
          uasg: msg.biddingProcess?.uasg || null,
          companyId: msg.biddingProcess?.companyId || null,
          messages: [],
          lastMessageAt: msg.createdAt,
          unreadCount: 0,
          isImportant: false,
          isArchived: false,
        });
      }
      const group = groupMap.get(pid)!;
      group.messages.push(msg);
      if (new Date(msg.createdAt) > new Date(group.lastMessageAt)) {
        group.lastMessageAt = msg.createdAt;
      }
      if (msg.detectedKeyword) group.isImportant = true;
    }

    return Array.from(groupMap.values()).sort((a, b) =>
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    );
  })();

  // ── Apply filters ──
  const filteredGroups = processGroups.filter(g => {
    if (activeTab === 'important' && !g.isImportant) return false;
    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = g.title.toLowerCase().includes(q);
      const matchContent = g.messages.some(m => m.content.toLowerCase().includes(q));
      const matchUasg = g.uasg?.includes(q);
      if (!matchTitle && !matchContent && !matchUasg) return false;
    }
    // Company filter
    if (companyFilter !== 'all' && g.companyId !== companyFilter) return false;
    // Platform filter
    if (platformFilter !== 'all') {
      const portal = g.portal.toLowerCase();
      if (platformFilter === 'comprasnet' && !portal.includes('compras') && !portal.includes('cnet')) return false;
      if (platformFilter === 'pncp' && !portal.includes('pncp')) return false;
      if (platformFilter === 'bll' && !portal.includes('bll')) return false;
    }
    return true;
  });

  // ── Selected process messages ──
  const selectedGroup = filteredGroups.find(g => g.processId === selectedProcessId) || null;
  const selectedMessages = selectedGroup?.messages.sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  ) || [];

  // Auto-select first process
  useEffect(() => {
    if (!selectedProcessId && filteredGroups.length > 0) {
      setSelectedProcessId(filteredGroups[0].processId);
    }
  }, [filteredGroups, selectedProcessId]);

  // ── Scroll to bottom on process change ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedProcessId, selectedMessages.length]);

  const totalMessages = messages.length;
  const totalProcesses = processGroups.length;
  const importantCount = processGroups.filter(g => g.isImportant).length;

  if (loading) {
    return (
      <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Loader2 size={32} className="spinner" color="var(--color-primary)" />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ padding: 0, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      {/* ── Top Bar ── */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Satellite size={22} color="#059669" />
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Monitor de Chat</h1>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: '16px', marginLeft: '24px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
            {totalProcesses} {totalProcesses === 1 ? 'processo' : 'processos'} · {totalMessages} {totalMessages === 1 ? 'mensagem' : 'mensagens'}
          </span>
          {importantCount > 0 && (
            <span style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 600 }}>
              ⚡ {importantCount} com alertas
            </span>
          )}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          {refreshing && <Loader2 size={14} className="spinner" color="var(--color-text-tertiary)" />}
          <button className="btn btn-ghost" onClick={() => fetchMessages(true)} title="Atualizar" style={{ padding: '6px' }}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* ── Split Panel ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── LEFT: Process List ── */}
        <div style={{ width: '380px', minWidth: '320px', borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', background: 'var(--color-bg-base)' }}>

          {/* Filters */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Search */}
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
              <input
                type="text"
                placeholder="Buscar por edital, nº processo, UASG..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: '100%', padding: '8px 12px 8px 32px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', fontSize: '0.8125rem', color: 'var(--color-text-primary)', outline: 'none' }}
              />
            </div>

            {/* Dropdowns Row */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <select
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                style={{ flex: 1, padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', fontSize: '0.75rem', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
              >
                <option value="all">Todas empresas</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
                style={{ flex: 1, padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', fontSize: '0.75rem', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
              >
                <option value="all">Todas plataformas</option>
                <option value="comprasnet">ComprasNet</option>
                <option value="pncp">PNCP</option>
                <option value="bll">BLL</option>
              </select>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '4px' }}>
              {([
                { key: 'all' as TabFilter, label: 'Todos', count: processGroups.length },
                { key: 'important' as TabFilter, label: 'Importantes', count: importantCount },
              ]).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '0.75rem',
                    fontWeight: activeTab === tab.key ? 600 : 400,
                    background: activeTab === tab.key ? 'var(--color-primary)' : 'var(--color-bg-surface)',
                    color: activeTab === tab.key ? 'white' : 'var(--color-text-secondary)',
                    cursor: 'pointer',
                    transition: 'all 150ms',
                  }}
                >
                  {tab.label} {tab.count > 0 && <span style={{ opacity: 0.7 }}>({tab.count})</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Process List */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filteredGroups.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>
                <MessageSquare size={32} style={{ marginBottom: '12px', opacity: 0.3 }} />
                <p>Nenhuma mensagem capturada ainda.</p>
                <p style={{ fontSize: '0.75rem', marginTop: '8px' }}>Ative o monitoramento nos cards de licitação.</p>
              </div>
            ) : (
              filteredGroups.map(group => {
                const isSelected = group.processId === selectedProcessId;
                const badge = portalBadge(group.portal);
                const company = companies.find(c => c.id === group.companyId);
                const lastMsg = group.messages[group.messages.length - 1];
                const preview = lastMsg?.content?.substring(0, 80) || '';

                return (
                  <div
                    key={group.processId}
                    onClick={() => setSelectedProcessId(group.processId)}
                    style={{
                      padding: '14px 16px',
                      borderBottom: '1px solid var(--color-border)',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--color-primary-light)' : 'transparent',
                      borderLeft: isSelected ? '3px solid var(--color-primary)' : '3px solid transparent',
                      transition: 'all 150ms',
                    }}
                  >
                    {/* Title + Badge */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-primary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '1.3' }}>
                        {group.isImportant && <span style={{ color: '#f59e0b', marginRight: '4px' }}>⚡</span>}
                        {group.title.substring(0, 70)}{group.title.length > 70 ? '...' : ''}
                      </span>
                      <span style={{ fontSize: '0.625rem', padding: '2px 6px', borderRadius: '4px', background: badge.bg, color: badge.color, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {badge.label}
                      </span>
                    </div>

                    {/* Company */}
                    {company && (
                      <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-tertiary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Building2 size={10} />
                        {company.name}
                      </div>
                    )}

                    {/* Preview + Time */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {preview}...
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', flexShrink: 0 }}>
                        <span style={{ fontSize: '0.625rem', color: 'var(--color-text-tertiary)' }}>
                          {new Date(group.lastMessageAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                        </span>
                        <span style={{ fontSize: '0.625rem', color: 'var(--color-text-tertiary)' }}>
                          {new Date(group.lastMessageAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>

                    {/* Message count */}
                    <div style={{ marginTop: '6px', display: 'flex', gap: '8px', fontSize: '0.6875rem', color: 'var(--color-text-tertiary)' }}>
                      <span>📨 {group.messages.length} msgs</span>
                      {group.messages.filter(m => m.detectedKeyword).length > 0 && (
                        <span style={{ color: '#f59e0b', fontWeight: 600 }}>
                          🔔 {group.messages.filter(m => m.detectedKeyword).length} alertas
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── RIGHT: Chat Messages ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--color-bg-base)', overflow: 'hidden' }}>
          {selectedGroup ? (
            <>
              {/* Process Header */}
              <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 4px 0', color: 'var(--color-text-primary)' }}>
                      {selectedGroup.title}
                    </h2>
                    <div style={{ display: 'flex', gap: '12px', fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                      {selectedGroup.uasg && <span>UASG: {selectedGroup.uasg}</span>}
                      {selectedGroup.modality && <span>{selectedGroup.modality}</span>}
                      <span>{(() => { const b = portalBadge(selectedGroup.portal); return b.label; })()}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <span style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '6px', background: 'var(--color-bg-surface-hover)', color: 'var(--color-text-secondary)' }}>
                      {selectedMessages.length} mensagens
                    </span>
                  </div>
                </div>
              </div>

              {/* Messages Area */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
                <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {selectedMessages.map(msg => {
                    const colors = authorColor(msg.authorType);
                    const hasKeyword = !!msg.detectedKeyword;

                    return (
                      <div
                        key={msg.id}
                        style={{
                          padding: '14px 18px',
                          borderRadius: '12px',
                          background: colors.bg,
                          border: `1px solid ${hasKeyword ? 'rgba(245, 158, 11, 0.3)' : colors.border}`,
                          boxShadow: hasKeyword ? '0 0 0 1px rgba(245, 158, 11, 0.1)' : 'none',
                        }}
                      >
                        {/* Author Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: colors.text, fontSize: '0.75rem', fontWeight: 600 }}>
                            <AuthorIcon type={msg.authorType} />
                            <span>{authorLabel(msg.authorType)}</span>
                            {msg.itemRef && (
                              <span style={{ padding: '1px 6px', borderRadius: '4px', background: 'rgba(0,0,0,0.05)', fontSize: '0.6875rem', fontWeight: 400 }}>
                                Item {msg.itemRef}
                              </span>
                            )}
                            {hasKeyword && (
                              <span style={{ padding: '1px 8px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.15)', color: '#d97706', fontSize: '0.6875rem', fontWeight: 600 }}>
                                ⚡ {msg.detectedKeyword}
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-tertiary)' }}>
                            {new Date(msg.createdAt).toLocaleDateString('pt-BR')} {new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        {/* Message Content */}
                        <div style={{ fontSize: '0.8125rem', lineHeight: 1.6, color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>
                          {highlightKeywords(msg.content, msg.detectedKeyword)}
                        </div>

                        {/* Source badge */}
                        {msg.captureSource && (
                          <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                            <span style={{ fontSize: '0.625rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(0,0,0,0.04)', color: 'var(--color-text-tertiary)' }}>
                              via {msg.captureSource === 'comprasnet-xhr' ? 'ComprasNet' : msg.captureSource === 'pncp-status' ? 'PNCP' : msg.captureSource}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', gap: '16px' }}>
              <Satellite size={48} style={{ opacity: 0.2 }} />
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Selecione um processo</p>
                <p style={{ fontSize: '0.8125rem' }}>Escolha um processo na lista à esquerda para ver as mensagens do chat.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
