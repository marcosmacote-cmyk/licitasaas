import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '../../config';
import { useToast } from '../ui';

export type TabFilter = 'all' | 'unread' | 'important' | 'archived';

export interface ChatMessage {
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

export interface ProcessSummary {
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

interface UseChatMonitorParams {
  companies: { id: string; name?: string; cnpj?: string; }[];
}

export function useChatMonitor({ }: UseChatMonitorParams) {
  const toast = useToast();

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
  const [enabledCategories, setEnabledCategories] = useState<string[]>([]);
  const [customKeywords, setCustomKeywords] = useState<string[]>([]);
  const [categoryCustomKeywords, setCategoryCustomKeywords] = useState<Record<string, string[]>>({});
  const [taxonomy, setTaxonomy] = useState<any>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingNotif, setTestingNotif] = useState(false);
  const [health, setHealth] = useState<any>(null);

  // ── State: ComprasNet Watcher ──
  const [watcherStatus, setWatcherStatus] = useState<any>(null);

  const token = localStorage.getItem('token');
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // ══════════════════════════════════════
  // ── API: Fetch process list ──
  // ══════════════════════════════════════
  const fetchProcesses = useCallback(async (silent = false) => {
    if (!silent) setLoadingProcesses(true);
    else setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (companyFilter !== 'all') params.set('companyId', companyFilter);
      if (platformFilter !== 'all') params.set('platform', platformFilter);
      const res = await fetch(`${API_BASE_URL}/api/chat-monitor/processes?${params}`, { headers });
      if (res.ok) { const data = await res.json(); setProcesses(data); }
    } catch (err) { console.error('Failed to fetch processes:', err); }
    finally { setLoadingProcesses(false); setRefreshing(false); }
  }, [companyFilter, platformFilter]);

  useEffect(() => {
    fetchProcesses();
    const interval = setInterval(() => fetchProcesses(true), 15000);
    return () => clearInterval(interval);
  }, [fetchProcesses]);

  // ── API: Fetch messages for selected process ──
  const fetchMessages = useCallback(async (processId: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/chat-monitor/messages/${processId}`, { headers });
      if (res.ok) { const data = await res.json(); setSelectedMessages(data.messages || []); }
    } catch (err) { console.error('Failed to fetch messages:', err); }
    finally { setLoadingMessages(false); }
  }, []);

  // Fetch config + health + taxonomy on mount
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
          // Parse new fields
          try { setEnabledCategories(JSON.parse(data.enabledCategories || '[]')); } catch { /* */ }
          try { setCustomKeywords(JSON.parse(data.customKeywords || '[]')); } catch { /* */ }
          try { setCategoryCustomKeywords(JSON.parse(data.categoryCustomKeywords || '{}')); } catch { /* */ }
        }
      } catch { /* silent */ }
    };
    const fetchTaxonomy = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/chat-monitor/taxonomy`, { headers });
        if (res.ok) {
          const data = await res.json();
          setTaxonomy(data);
          // Se enabledCategories vazio, usar defaults da taxonomy
          setEnabledCategories(prev => prev.length > 0 ? prev : (data.defaultEnabled || []));
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
    fetchTaxonomy();
    fetchHealth();
  }, []);

  // Fetch ComprasNet Watcher status
  const fetchWatcherStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/chat-monitor/agents/status`, { headers });
      if (res.ok) setWatcherStatus(await res.json());
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchWatcherStatus();
    const interval = setInterval(fetchWatcherStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchWatcherStatus]);

  // Load messages when selection changes
  useEffect(() => {
    if (selectedProcessId) { fetchMessages(selectedProcessId); }
    else { setSelectedMessages([]); }
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
    if (proc && proc.unreadCount > 0) { markProcessRead(processId); }
  };

  const handleTestNotification = async () => {
    setTestingNotif(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/chat-monitor/test`, { method: 'POST', headers });
      const data = await res.json();
      const parts: string[] = [];
      if (data.results?.telegram === true) parts.push('Telegram OK — ✓');
      else if (data.results?.telegram === false) parts.push('Telegram: falha');
      if (data.results?.whatsapp === true) parts.push('WhatsApp OK — ✓');
      else if (data.results?.whatsapp === false) parts.push('WhatsApp: falha');
      toast.info(parts.length > 0 ? parts.join(' | ') : data.message);
    } catch { toast.error('Falha no teste.'); }
    finally { setTestingNotif(false); }
  };

  const toggleCategory = (catId: string) => {
    setEnabledCategories(prev =>
      prev.includes(catId) ? prev.filter(c => c !== catId) : [...prev, catId]
    );
  };

  const addCustomKeyword = (kw: string) => {
    const trimmed = kw.trim().toLowerCase();
    if (trimmed && !customKeywords.includes(trimmed)) {
      setCustomKeywords(prev => [...prev, trimmed]);
    }
  };

  const removeCustomKeyword = (kw: string) => {
    setCustomKeywords(prev => prev.filter(k => k !== kw));
  };

  const addCategoryKeyword = (catId: string, kw: string) => {
    const trimmed = kw.trim().toLowerCase();
    if (!trimmed) return;
    setCategoryCustomKeywords(prev => {
      const existing = prev[catId] || [];
      if (existing.includes(trimmed)) return prev;
      return { ...prev, [catId]: [...existing, trimmed] };
    });
  };

  const removeCategoryKeyword = (catId: string, kw: string) => {
    setCategoryCustomKeywords(prev => {
      const existing = prev[catId] || [];
      const updated = existing.filter(k => k !== kw);
      if (updated.length === 0) {
        const { [catId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [catId]: updated };
    });
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const payload = {
        ...monitorConfig,
        enabledCategories,
        customKeywords,
        categoryCustomKeywords,
      };
      const res = await fetch(`${API_BASE_URL}/api/chat-monitor/config`, { method: 'POST', headers, body: JSON.stringify(payload) });
      if (res.ok) toast.success('Configurações salvas!');
      else toast.error('Erro ao salvar');
    } catch { toast.error('Falha na conexão.'); }
    finally { setSavingConfig(false); }
  };

  // ══════════════════════════════════════
  // ── Filters ──
  // ══════════════════════════════════════
  const filteredProcesses = processes.filter(p => {
    if (activeTab === 'archived') return p.isArchived;
    if (p.isArchived) return false;
    if (activeTab === 'unread' && p.unreadCount === 0) return false;
    if (activeTab === 'important' && !p.isImportant) return false;
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

  return {
    // State
    processes, loadingProcesses, refreshing,
    selectedProcessId, setSelectedProcessId, selectedMessages, loadingMessages,
    activeTab, setActiveTab, searchQuery, setSearchQuery,
    companyFilter, setCompanyFilter, platformFilter, setPlatformFilter,
    messagesEndRef,
    // Config
    showConfig, setShowConfig, monitorConfig, setMonitorConfig,
    enabledCategories, customKeywords, categoryCustomKeywords, taxonomy,
    toggleCategory, addCustomKeyword, removeCustomKeyword,
    addCategoryKeyword, removeCategoryKeyword,
    savingConfig, testingNotif, health, watcherStatus,
    // Computed
    filteredProcesses, selectedProc,
    totalProcesses, totalMessages, unreadProcessCount, importantCount, archivedCount,
    // Handlers
    fetchProcesses, handleSelectProcess,
    markProcessRead, toggleProcessImportant, toggleProcessArchive,
    handleTestNotification, handleSaveConfig,
  };
}
