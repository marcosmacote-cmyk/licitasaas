import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import {
  Briefcase,
  LayoutDashboard,
  Building2,
  Settings,
  Bell,
  Sun,
  Moon,
  Loader2,
  Radar,
  BrainCircuit,
  FileOutput,
  Satellite,
  BarChart3,
  LogOut,
  Gavel
} from 'lucide-react';
// Static imports — core pages that load on startup
import { BiddingPage } from './components/BiddingPage';
import { Dashboard } from './components/Dashboard';
import { LoginPage } from './components/LoginPage';
import type { BiddingProcess, CompanyProfile } from './types';
import { API_BASE_URL } from './config';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/ui';

// Lazy imports — pages loaded on demand
const PncpPage = lazy(() => import('./components/PncpPage').then(m => ({ default: m.PncpPage })));
const DocumentsPage = lazy(() => import('./components/DocumentsPage').then(m => ({ default: m.DocumentsPage })));
const SettingsPage = lazy(() => import('./components/SettingsPage').then(m => ({ default: m.SettingsPage })));
const ChatMonitorPage = lazy(() => import('./components/ChatMonitorPage').then(m => ({ default: m.ChatMonitorPage })));
const InteligenciaPage = lazy(() => import('./components/InteligenciaPage').then(m => ({ default: m.InteligenciaPage })));
const ProducaoPage = lazy(() => import('./components/ProducaoPage').then(m => ({ default: m.ProducaoPage })));
const ResultadosPage = lazy(() => import('./components/ResultadosPage').then(m => ({ default: m.ResultadosPage })));

type AppTab = 'dashboard' | 'opportunities' | 'bidding' | 'intelligence' | 'companies' | 'production' | 'monitoring' | 'results' | 'settings';

function App() {
  const [user, setUser] = useState<any>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [items, setItems] = useState<BiddingProcess[]>([]);
  const [companies, setCompanies] = useState<CompanyProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const lastLogIdRef = useRef<string | null>(null);
  const [alertCount, setAlertCount] = useState(0);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [navFilter, setNavFilter] = useState<{ statuses?: string[]; highlight?: string } | null>(null);

  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');

    if (savedUser && token) {
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
  }, []);

  const fetchCompanies = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/companies`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.status === 401 || response.status === 403) {
        handleLogout();
        return;
      }

      if (response.ok) {
        const data = await response.json();
        setCompanies(data);
      }
    } catch (err) {
      console.error('Failed to load companies', err);
    }
  };

  const fetchBiddings = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/biddings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.status === 401 || response.status === 403) {
        handleLogout();
        return;
      }

      if (response.ok) {
        const data = await response.json();
        setItems(data);
      }
    } catch (error) {
      console.error("Failed to load biddings from API", error);
    }
  };

  useEffect(() => {
    if (!user) return;
    fetchCompanies();
    fetchBiddings();

    // Browser Notification Support
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    // Interval to check for Chat Monitor Logs (Sound Alert)
    const checkChatLogs = async () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      try {
        const res = await fetch(`${API_BASE_URL}/api/chat-monitor/logs?limit=1`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          const logs = data.logs || [];
          if (logs.length > 0) {
            const latestLog = logs[0];
            if (lastLogIdRef.current && latestLog.id !== lastLogIdRef.current && latestLog.detectedKeyword) {
              setAlertCount(prev => prev + 1);
              try {
                const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const oscillator = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                oscillator.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                oscillator.frequency.value = 880;
                oscillator.type = 'sine';
                gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
                oscillator.start(audioCtx.currentTime);
                oscillator.stop(audioCtx.currentTime + 0.5);
              } catch (audioErr) {
                console.error("Audio alert failed:", audioErr);
              }

              if (Notification.permission === "granted") {
                new Notification("Alerta de Chat PNCP", {
                  body: `Palavra-chave "${latestLog.detectedKeyword}" detectada!`,
                  icon: "https://pncp.gov.br/app/favicon.ico"
                });
              }
            }
            lastLogIdRef.current = latestLog.id;
          }
        }
      } catch (err) {
        console.error("Failed to fetch chat logs:", err);
      }
    };

    const interval = setInterval(checkChatLogs, 30000);
    checkChatLogs();

    // Poll unread count for sidebar badge
    const fetchUnreadCount = async () => {
      const token = localStorage.getItem('token');
      if (!token) return;
      try {
        const res = await fetch(`${API_BASE_URL}/api/chat-monitor/unread-count`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setChatUnreadCount(data.count || 0);
        }
      } catch { /* silent */ }
    };
    const unreadInterval = setInterval(fetchUnreadCount, 30000);
    fetchUnreadCount();

    return () => { clearInterval(interval); clearInterval(unreadInterval); };
  }, [user]);

  const refreshData = async () => {
    await Promise.all([fetchCompanies(), fetchBiddings()]);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--color-bg-base)' }}>
        <Loader2 size={48} className="spinner" color="var(--color-primary)" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLoginSuccess={(u: any) => setUser(u)} />;
  }

  // ── Navigation Structure ──
  const navGroups: {
    label?: string;
    items: {
      key: AppTab;
      label: string;
      icon: React.ReactNode;
      badge?: number;
      badgeType?: 'red' | 'blue' | 'ai';
    }[];
  }[] = [
    {
      label: 'Visão Geral',
      items: [
        { key: 'dashboard', label: 'Painel', icon: <LayoutDashboard size={18} /> },
      ],
    },
    {
      label: 'Operação',
      items: [
        { key: 'opportunities', label: 'Oportunidades', icon: <Radar size={18} /> },
        { key: 'bidding', label: 'Licitações', icon: <Briefcase size={18} /> },
        { key: 'intelligence', label: 'Inteligência', icon: <BrainCircuit size={18} /> },
        { key: 'companies', label: 'Empresas', icon: <Building2 size={18} /> },
      ],
    },
    {
      label: 'Produtividade',
      items: [
        { key: 'production', label: 'Produção', icon: <FileOutput size={18} /> },
        { key: 'monitoring', label: 'Monitoramento', icon: <Satellite size={18} />, badge: chatUnreadCount || undefined, badgeType: 'red' },
        { key: 'results', label: 'Resultados', icon: <BarChart3 size={18} /> },
      ],
    },
  ];

  // Get current page title for header
  const currentPageLabel = navGroups.flatMap(g => g.items).find(i => i.key === activeTab)?.label || 'Painel';

  return (
    <ToastProvider>
    <ErrorBoundary>
      <div className="app-container">
        {/* ═══════════════════════════
            SIDEBAR — Nova Navegação
            ═══════════════════════════ */}
        <aside className="sidebar">
          {/* Logo */}
          <div className="sidebar-header">
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(99,102,241,0.45)',
              flexShrink: 0,
            }}>
              <Gavel size={18} />
            </div>
            <span style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 'var(--font-extrabold)',
              color: '#ffffff',
              letterSpacing: '-0.03em',
              lineHeight: 1,
            }}>LicitaSaaS</span>
          </div>

          <nav className="sidebar-nav">
            {navGroups.map((group, gi) => (
              <div key={gi}>
                {group.label && (
                  <div className="nav-section-label">{group.label}</div>
                )}
                {group.items.map(item => (
                  <a
                    key={item.key}
                    href="#"
                    className={`nav-item ${activeTab === item.key ? 'active' : ''}`}
                    onClick={(e) => {
                      e.preventDefault();
                      setActiveTab(item.key);
                      if (item.key === 'settings') setAlertCount(0);
                    }}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    {item.badge && item.badge > 0 && (
                      <span className={`nav-badge nav-badge-${item.badgeType || 'blue'}`}>
                        {item.badge}
                      </span>
                    )}
                  </a>
                ))}
              </div>
            ))}

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Divider before settings */}
            <div className="nav-divider" />

            {/* Settings */}
            <a
              href="#"
              className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={(e) => { e.preventDefault(); setActiveTab('settings'); setAlertCount(0); }}
            >
              <Settings size={18} />
              <span>Configurações</span>
              {alertCount > 0 && (
                <span className="nav-badge nav-badge-red">{alertCount}</span>
              )}
            </a>
          </nav>
        </aside>

        {/* ═══════════════════════════
            MAIN CONTENT
            ═══════════════════════════ */}
        <main className="main-content">
          {/* Header */}
          <header className="header">
            {/* Left: Page context */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <span style={{
                fontSize: 'var(--text-lg)',
                fontWeight: 'var(--font-semibold)',
                color: 'var(--color-text-primary)'
              }}>
                {currentPageLabel}
              </span>
            </div>

            {/* Right: Actions + User */}
            <div className="flex-gap">
              <button className="icon-btn" onClick={toggleTheme} title="Alternar Tema">
                {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
              </button>
              <button className="icon-btn" style={{ position: 'relative' }}>
                <Bell size={18} />
                {alertCount > 0 && (
                  <span style={{
                    position: 'absolute', top: 4, right: 4,
                    width: 7, height: 7,
                    background: 'var(--color-danger)',
                    borderRadius: '50%',
                    border: '2px solid var(--color-bg-surface)'
                  }} />
                )}
              </button>

              <div style={{ width: '1px', height: '24px', background: 'var(--color-border)', margin: '0 var(--space-2)' }} />

              <div className="flex-gap" style={{ gap: 'var(--space-3)' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-md)', lineHeight: 1.3 }}>{user.name}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{user.tenantName}</div>
                </div>
                <div
                  style={{
                    width: 32, height: 32,
                    background: 'var(--color-primary)',
                    borderRadius: 'var(--radius-full)',
                    color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 'var(--font-bold)', fontSize: 'var(--text-sm)'
                  }}
                  title={user.email}
                >
                  {user.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2)}
                </div>
                <button
                  className="icon-btn"
                  onClick={handleLogout}
                  title="Sair"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  <LogOut size={16} />
                </button>
              </div>
            </div>
          </header>

          {/* ── Page Content ── */}
          <Suspense fallback={<div className="flex-center" style={{ padding: 'var(--space-20)', justifyContent: 'center' }}><Loader2 size={32} className="spinner" color="var(--color-primary)" /></div>}>
          {activeTab === 'dashboard' && <Dashboard items={items} companies={companies} onNavigate={(tab, filter) => { setNavFilter(filter || null); setActiveTab(tab as AppTab); }} />}
          {activeTab === 'opportunities' && <PncpPage companies={companies} onRefresh={refreshData} items={items} />}
          {activeTab === 'bidding' && <BiddingPage items={items} setItems={setItems} companies={companies} initialFilter={navFilter} onFilterConsumed={() => setNavFilter(null)} />}
          {activeTab === 'intelligence' && <InteligenciaPage biddings={items} companies={companies} onRefresh={refreshData} />}
          {activeTab === 'companies' && <DocumentsPage companies={companies} setCompanies={setCompanies} />}
          {activeTab === 'production' && <ProducaoPage biddings={items} companies={companies} onRefresh={refreshData} />}
          {activeTab === 'monitoring' && <ChatMonitorPage companies={companies} />}
          {activeTab === 'results' && <ResultadosPage biddings={items} companies={companies} />}
          {activeTab === 'settings' && <SettingsPage />}
          </Suspense>
        </main>
      </div>
    </ErrorBoundary>
    </ToastProvider>
  );
}

export default App;
