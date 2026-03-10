import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquare, Search, RefreshCw, Loader2, Satellite, Gavel, Building2, User, Bot, Star, Archive, ArchiveRestore, CheckCheck, Settings, Save, Bell, Phone, Send, Zap, CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react';
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
  isRead: boolean;
  isImportant: boolean;
  isArchived: boolean;
  createdAt: string;
  status: string;
  biddingProcessId: string;
}

interface ProcessSummary {
  id: string;
  title: string;
  portal: string;
  modality: string;
  uasg: string | null;
  companyProfileId: string | null;
  isMonitored?: boolean;
  totalMessages: number;
  unreadCount: number;
  isImportant: boolean;
  isArchived: boolean;
  lastMessage: {
    content: string;
    createdAt: string;
    authorType: string | null;
    detectedKeyword: string | null;
  } | null;
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
  // ── State: Process List (left panel) ──
  const [processes, setProcesses] = useState<ProcessSummary[]>([]);
  const [loadingProcesses, setLoadingProcesses] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── State: Selected Process Messages (right panel) ──
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // ── State: Filters ──
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── State: Config Panel ──
  const [showConfig, setShowConfig] = useState(false);
  const [monitorConfig, setMonitorConfig] = useState({ keywords: 'suspensa,reaberta,vencedora', phoneNumber: '', telegramChatId: '', isActive: true });
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingNotif, setTestingNotif] = useState(false);
  const [health, setHealth] = useState<any>(null);

  const token = localStorage.getItem('token');
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // ══════════════════════════════════════
  // ── API: Fetch process list (lightweight) ──
  // ══════════════════════════════════════
  const fetchProcesses = useCallback(async (silent = false) => {
    if (!silent) setLoadingProcesses(true);
    else setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (companyFilter !== 'all') params.set('companyId', companyFilter);
      if (platformFilter !== 'all') params.set('platform', platformFilter);

      const res = await fetch(`${API_BASE_URL}/api/chat-monitor/processes?${params}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setProcesses(data);
      }
    } catch (err) {
      console.error('Failed to fetch processes:', err);
    } finally {
      setLoadingProcesses(false);
      setRefreshing(false);
    }
  }, [companyFilter, platformFilter]);

  useEffect(() => {
    fetchProcesses();
    const interval = setInterval(() => fetchProcesses(true), 15000);
    return () => clearInterval(interval);
  }, [fetchProcesses]);

  // ══════════════════════════════════════
  // ── API: Fetch messages for selected process ──
  // ══════════════════════════════════════
  const fetchMessages = useCallback(async (processId: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/chat-monitor/messages/${processId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSelectedMessages(data.messages || []);
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // Fetch config + health on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/chat-monitor/config`, { headers });
        if (res.ok) {
          const data = await res.json();
          setMonitorConfig({
            keywords: data.keywords || 'suspensa,reaberta,vencedora',
            phoneNumber: data.phoneNumber || '',
            telegramChatId: data.telegramChatId || '',
            isActive: data.isActive ?? true
          });
        }
      } catch { /* silent */ }
    };
    const fetchHealth = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/chat-monitor/health`, { headers });
        if (res.ok) setHealth(await res.json());
      } catch { /* silent */ }
    };
    fetchConfig();
    fetchHealth();
  }, []);

  // Load messages when selection changes
  useEffect(() => {
    if (selectedProcessId) {
      fetchMessages(selectedProcessId);
    } else {
      setSelectedMessages([]);
    }
  }, [selectedProcessId, fetchMessages]);

  // Auto-refresh selected process messages
  useEffect(() => {
    if (!selectedProcessId) return;
    const interval = setInterval(() => fetchMessages(selectedProcessId), 20000);
    return () => clearInterval(interval);
  }, [selectedProcessId, fetchMessages]);

  // ══════════════════════════════════════
  // ── Actions ──
  // ══════════════════════════════════════
  const markProcessRead = async (processId: string) => {
    try {
      await fetch(`${API_BASE_URL}/api/chat-monitor/read-all/${processId}`, { method: 'PUT', headers });
      setProcesses(prev => prev.map(p => p.id === processId ? { ...p, unreadCount: 0 } : p));
    } catch { /* silent */ }
  };

  const toggleProcessImportant = async (processId: string, current: boolean) => {
    try {
      await fetch(`${API_BASE_URL}/api/chat-monitor/process-action/${processId}`, {
        method: 'PUT', headers, body: JSON.stringify({ isImportant: !current })
      });
      setProcesses(prev => prev.map(p => p.id === processId ? { ...p, isImportant: !current } : p));
    } catch { /* silent */ }
  };

  const toggleProcessArchive = async (processId: string, current: boolean) => {
    try {
      await fetch(`${API_BASE_URL}/api/chat-monitor/process-action/${processId}`, {
        method: 'PUT', headers, body: JSON.stringify({ isArchived: !current })
      });
      setProcesses(prev => prev.map(p => p.id === processId ? { ...p, isArchived: !current } : p));
      if (!current && selectedProcessId === processId) setSelectedProcessId(null);
    } catch { /* silent */ }
  };

  const handleSelectProcess = (processId: string) => {
    setSelectedProcessId(processId);
    const proc = processes.find(p => p.id === processId);
    if (proc && proc.unreadCount > 0) {
      markProcessRead(processId);
    }
  };

  // ══════════════════════════════════════
  // ── Filters ──
  // ══════════════════════════════════════
  const filteredProcesses = processes.filter(p => {
    // Tab filter
    if (activeTab === 'archived') return p.isArchived;
    if (p.isArchived) return false;
    if (activeTab === 'unread' && p.unreadCount === 0) return false;
    if (activeTab === 'important' && !p.isImportant) return false;
    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = p.title.toLowerCase().includes(q);
      const matchUasg = p.uasg?.toLowerCase().includes(q);
      const matchContent = p.lastMessage?.content?.toLowerCase().includes(q);
      if (!matchTitle && !matchUasg && !matchContent) return false;
    }
    return true;
  });

  // Auto-select first process
  useEffect(() => {
    if (!selectedProcessId && filteredProcesses.length > 0) {
      setSelectedProcessId(filteredProcesses[0].id);
    }
  }, [filteredProcesses, selectedProcessId]);

  // Scroll to bottom on process change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedProcessId, selectedMessages.length]);

  // ── Counts ──
  const totalProcesses = processes.filter(p => !p.isArchived).length;
  const totalMessages = processes.reduce((sum, p) => sum + p.totalMessages, 0);
  const unreadProcessCount = processes.filter(p => p.unreadCount > 0 && !p.isArchived).length;
  const importantCount = processes.filter(p => p.isImportant && !p.isArchived).length;
  const archivedCount = processes.filter(p => p.isArchived).length;

  const selectedProc = filteredProcesses.find(p => p.id === selectedProcessId) || null;

  if (loadingProcesses) {
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
          <button className="btn btn-ghost" onClick={() => fetchProcesses(true)} title="Atualizar" style={{ padding: '6px' }}>
            <RefreshCw size={16} />
          </button>
          <button className="btn btn-ghost" onClick={() => setShowConfig(!showConfig)} title="Configurações do Monitor" style={{ padding: '6px', color: showConfig ? 'var(--color-primary)' : undefined }}>
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* ── Config Panel (collapsible) ── */}
      {showConfig && (
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-base)', flexShrink: 0, display: 'grid', gap: '16px', maxHeight: '300px', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', alignItems: 'end' }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>
                <Bell size={12} /> Palavras-chave de Alerta
              </label>
              <input
                type="text"
                value={monitorConfig.keywords}
                onChange={(e) => setMonitorConfig({...monitorConfig, keywords: e.target.value})}
                placeholder="suspensa, reaberta, vencedora..."
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', fontSize: '0.8125rem', color: 'var(--color-text-primary)' }}
              />
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>
                <Phone size={12} color="#10b981" /> WhatsApp
              </label>
              <input
                type="text"
                value={monitorConfig.phoneNumber}
                onChange={(e) => setMonitorConfig({...monitorConfig, phoneNumber: e.target.value})}
                placeholder="+5585999999999"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', fontSize: '0.8125rem', color: 'var(--color-text-primary)' }}
              />
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>
                <Send size={12} color="#0088cc" /> Telegram Chat ID
              </label>
              <input
                type="text"
                value={monitorConfig.telegramChatId}
                onChange={(e) => setMonitorConfig({...monitorConfig, telegramChatId: e.target.value})}
                placeholder="Chat ID ou @usuario"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', fontSize: '0.8125rem', color: 'var(--color-text-primary)' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button
                className="btn btn-ghost"
                style={{ padding: '6px 14px', borderRadius: '8px', fontSize: '0.75rem', gap: '6px', border: '1px solid var(--color-border)' }}
                disabled={testingNotif}
                onClick={async () => {
                  setTestingNotif(true);
                  try {
                    const res = await fetch(`${API_BASE_URL}/api/chat-monitor/test`, { method: 'POST', headers });
                    const data = await res.json();
                    const parts: string[] = [];
                    if (data.results?.telegram === true) parts.push('✅ Telegram OK');
                    else if (data.results?.telegram === false) parts.push('❌ Telegram falhou');
                    if (data.results?.whatsapp === true) parts.push('✅ WhatsApp OK');
                    else if (data.results?.whatsapp === false) parts.push('❌ WhatsApp falhou');
                    alert(parts.length > 0 ? parts.join('\n') : data.message);
                  } catch { alert('Falha no teste.'); }
                  finally { setTestingNotif(false); }
                }}
              >
                {testingNotif ? <Loader2 size={12} className="spinner" /> : <Zap size={12} />}
                Testar
              </button>
              <button
                className="btn btn-primary"
                style={{ padding: '6px 16px', borderRadius: '8px', fontSize: '0.75rem', gap: '6px' }}
                disabled={savingConfig}
                onClick={async () => {
                  setSavingConfig(true);
                  try {
                    const res = await fetch(`${API_BASE_URL}/api/chat-monitor/config`, { method: 'POST', headers, body: JSON.stringify(monitorConfig) });
                    if (res.ok) alert('✅ Configurações salvas!');
                    else alert('❌ Erro ao salvar');
                  } catch { alert('❌ Falha na conexão.'); }
                  finally { setSavingConfig(false); }
                }}
              >
                {savingConfig ? <Loader2 size={12} className="spinner" /> : <Save size={12} />}
                Salvar
              </button>
            </div>
            {health && (
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {health.lastPollStatus === 'success' ? <CheckCircle size={12} color="var(--color-success)" /> : health.lastPollStatus === 'error' ? <XCircle size={12} color="var(--color-danger)" /> : <AlertTriangle size={12} color="var(--color-warning)" />}
                  {health.lastPollTime ? new Date(health.lastPollTime).toLocaleString('pt-BR') : 'Aguardando...'}
                </div>
                <span>📡 {health.monitoredProcesses || 0} monitorados</span>
                <span>🚨 {health.totalAlerts || 0} alertas</span>
              </div>
            )}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Info size={10} /> Ative o monitoramento nos cards do Kanban (ícone 📻) para que as mensagens sejam capturadas aqui.
          </div>
        </div>
      )}

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
                { key: 'all' as TabFilter, label: 'Todos', count: totalProcesses },
                { key: 'unread' as TabFilter, label: 'Não lidos', count: unreadProcessCount },
                { key: 'important' as TabFilter, label: 'Importantes', count: importantCount },
                { key: 'archived' as TabFilter, label: 'Arquivados', count: archivedCount },
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
            {filteredProcesses.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>
                <MessageSquare size={32} style={{ marginBottom: '12px', opacity: 0.3 }} />
                <p>Nenhuma mensagem capturada ainda.</p>
                <p style={{ fontSize: '0.75rem', marginTop: '8px' }}>Ative o monitoramento nos cards de licitação.</p>
              </div>
            ) : (
              filteredProcesses.map(proc => {
                const isSelected = proc.id === selectedProcessId;
                const badge = portalBadge(proc.portal);
                const company = companies.find(c => c.id === proc.companyProfileId);
                const preview = proc.lastMessage?.content?.substring(0, 80) || '';
                const lastMsgDate = proc.lastMessage?.createdAt;

                return (
                  <div
                    key={proc.id}
                    onClick={() => handleSelectProcess(proc.id)}
                    style={{
                      padding: '14px 16px',
                      borderBottom: '1px solid var(--color-border)',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--color-primary-light, rgba(37, 99, 235, 0.06))' : 'transparent',
                      borderLeft: isSelected ? '3px solid var(--color-primary)' : '3px solid transparent',
                      transition: 'all 150ms',
                    }}
                  >
                    {/* Title + Badge */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '0.8125rem', fontWeight: proc.unreadCount > 0 ? 700 : 600, color: 'var(--color-text-primary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '1.3' }}>
                        {proc.isImportant && <span style={{ color: '#f59e0b', marginRight: '4px' }}>⚡</span>}
                        {proc.title.substring(0, 70)}{proc.title.length > 70 ? '...' : ''}
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
                        {preview}{preview.length >= 80 ? '...' : ''}
                      </span>
                      {lastMsgDate && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', flexShrink: 0 }}>
                          <span style={{ fontSize: '0.625rem', color: 'var(--color-text-tertiary)' }}>
                            {new Date(lastMsgDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                          </span>
                          <span style={{ fontSize: '0.625rem', color: 'var(--color-text-tertiary)' }}>
                            {new Date(lastMsgDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Message count + unread badge */}
                    <div style={{ marginTop: '6px', display: 'flex', gap: '8px', fontSize: '0.6875rem', color: 'var(--color-text-tertiary)', alignItems: 'center' }}>
                      <span>📨 {proc.totalMessages} msgs</span>
                      {proc.unreadCount > 0 && (
                        <span style={{ padding: '1px 6px', borderRadius: '10px', background: 'var(--color-primary)', color: 'white', fontWeight: 600, fontSize: '0.625rem' }}>
                          {proc.unreadCount} novas
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
          {selectedProc ? (
            <>
              {/* Process Header */}
              <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 4px 0', color: 'var(--color-text-primary)' }}>
                      {selectedProc.title}
                    </h2>
                    <div style={{ display: 'flex', gap: '12px', fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                      {selectedProc.uasg && <span>UASG: {selectedProc.uasg}</span>}
                      {selectedProc.modality && <span>{selectedProc.modality}</span>}
                      <span>{portalBadge(selectedProc.portal).label}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '6px', background: 'var(--color-bg-surface-hover)', color: 'var(--color-text-secondary)' }}>
                      {selectedProc.totalMessages} mensagens
                    </span>
                    <button
                      title={selectedProc.isImportant ? 'Remover destaque' : 'Marcar como importante'}
                      onClick={(e) => { e.stopPropagation(); toggleProcessImportant(selectedProc.id, selectedProc.isImportant); }}
                      style={{ padding: '4px', borderRadius: '6px', border: 'none', background: selectedProc.isImportant ? 'rgba(245, 158, 11, 0.15)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                    >
                      <Star size={16} fill={selectedProc.isImportant ? '#f59e0b' : 'none'} color={selectedProc.isImportant ? '#f59e0b' : 'var(--color-text-tertiary)'} />
                    </button>
                    <button
                      title={selectedProc.isArchived ? 'Desarquivar' : 'Arquivar'}
                      onClick={(e) => { e.stopPropagation(); toggleProcessArchive(selectedProc.id, selectedProc.isArchived); }}
                      style={{ padding: '4px', borderRadius: '6px', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                    >
                      {selectedProc.isArchived ? <ArchiveRestore size={16} color="var(--color-text-tertiary)" /> : <Archive size={16} color="var(--color-text-tertiary)" />}
                    </button>
                    <button
                      title="Marcar tudo como lido"
                      onClick={() => markProcessRead(selectedProc.id)}
                      style={{ padding: '4px', borderRadius: '6px', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                    >
                      <CheckCheck size={16} color="var(--color-text-tertiary)" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Messages Area */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
                {loadingMessages ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                    <Loader2 size={24} className="spinner" color="var(--color-text-tertiary)" />
                  </div>
                ) : (
                  <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {selectedMessages.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>
                        Nenhuma mensagem para este processo.
                      </div>
                    ) : (
                      selectedMessages.map(msg => {
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
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}
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
