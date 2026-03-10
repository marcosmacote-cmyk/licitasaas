import { useState, useEffect, useRef } from 'react';
import {
  Briefcase,
  LayoutDashboard,
  Files,
  Settings,
  Bell,
  Sun,
  Moon,
  Building2,
  PieChart,
  Loader2,
  Search,
  Satellite
} from 'lucide-react';
import { PncpPage } from './components/PncpPage';
import { BiddingPage } from './components/BiddingPage';
import { Dashboard } from './components/Dashboard';
import { DocumentsPage } from './components/DocumentsPage';
import { ReportsPage } from './components/ReportsPage';
import { LoginPage } from './components/LoginPage';
import { SettingsPage } from './components/SettingsPage';
import { ChatMonitorPage } from './components/ChatMonitorPage';
import type { BiddingProcess, CompanyProfile } from './types';
import { API_BASE_URL } from './config';
import ErrorBoundary from './components/ErrorBoundary';

function App() {
  const [user, setUser] = useState<any>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'bidding' | 'documents' | 'reports' | 'pncp' | 'chat-monitor' | 'settings'>('dashboard');
  const [items, setItems] = useState<BiddingProcess[]>([]);
  const [companies, setCompanies] = useState<CompanyProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const lastLogIdRef = useRef<string | null>(null);
  const [alertCount, setAlertCount] = useState(0);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);

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
      // Don't clear companies on network error to allow offline/slow loading
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
    // Uses useRef to avoid re-creating the interval on every new log
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
            // If it's a new log and matches a keyword
            if (lastLogIdRef.current && latestLog.id !== lastLogIdRef.current && latestLog.detectedKeyword) {
              setAlertCount(prev => prev + 1);
              // Play Sound
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

              // Browser Notification
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

    const interval = setInterval(checkChatLogs, 30000); // Check every 30 seconds
    checkChatLogs(); // Initial check

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#f8fafc' }}>
        <Loader2 size={48} className="spinner" color="#2563eb" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLoginSuccess={(u: any) => setUser(u)} />;
  }

  return (
    <ErrorBoundary>
      <div className="app-container">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <Building2 size={24} />
            <span>LicitaSaaS</span>
          </div>
          <nav className="sidebar-nav">
            <a href="#" className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('dashboard'); }}>
              <LayoutDashboard size={20} />
              <span>Dashboard</span>
            </a>

            <a href="#" className={`nav-item ${activeTab === 'bidding' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('bidding'); }}>
              <Briefcase size={20} />
              <span>Licitações</span>
            </a>
            <a href="#" className={`nav-item ${activeTab === 'documents' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('documents'); }}>
              <Files size={20} />
              <span>Documentos</span>
            </a>
            <a href="#" className={`nav-item ${activeTab === 'pncp' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('pncp'); }}>
              <Search size={20} />
              <span>Busca PNCP</span>
            </a>
            <a href="#" className={`nav-item ${activeTab === 'chat-monitor' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('chat-monitor'); }}>
              <div style={{ position: 'relative' }}>
                <Satellite size={20} />
                {chatUnreadCount > 0 && <span className="badge badge-red" style={{ position: 'absolute', top: '-8px', right: '-8px', fontSize: '0.6rem', padding: '2px 5px', minWidth: '15px' }}>{chatUnreadCount}</span>}
              </div>
              <span>Monitor Chat</span>
            </a>
            <a href="#" className={`nav-item ${activeTab === 'reports' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('reports'); }}>
              <PieChart size={20} />
              <span>Relatórios</span>
            </a>
            <div style={{ flex: 1 }}></div>
            <a href="#" className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('settings'); setAlertCount(0); }}>
              <div style={{ position: 'relative' }}>
                <Settings size={20} />
                {alertCount > 0 && <span className="badge badge-red" style={{ position: 'absolute', top: '-8px', right: '-8px', fontSize: '0.6rem', padding: '2px 5px', minWidth: '15px' }}>{alertCount}</span>}
              </div>
              <span>Configurações</span>
            </a>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="main-content">
          {/* Header */}
          <header className="header">
            <div className="flex-gap" style={{ width: '300px' }}>
            </div>

            <div className="flex-gap">
              <button className="icon-btn" onClick={toggleTheme} title="Alternar Tema">
                {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
              </button>
              <button className="icon-btn" style={{ position: 'relative' }}>
                <Bell size={20} />
                <span style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, background: 'var(--color-danger)', borderRadius: '50%' }}></span>
              </button>
              <div className="flex-gap" style={{ marginLeft: 16 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{user.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>{user.tenantName}</div>
                </div>
                <div
                  style={{ width: 32, height: 32, background: 'var(--color-primary)', borderRadius: '50%', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.875rem' }}
                  title={user.email}
                >
                  {user.name.split(' ').map((n: string) => n[0]).join('')}
                </div>
                <button
                  className="btn btn-ghost"
                  style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                  onClick={handleLogout}
                >
                  Sair
                </button>
              </div>
            </div>
          </header>

          {/* Page Content */}
          {activeTab === 'dashboard' && <Dashboard items={items} />}
          {activeTab === 'documents' && <DocumentsPage companies={companies} setCompanies={setCompanies} />}

          {activeTab === 'bidding' && <BiddingPage items={items} setItems={setItems} companies={companies} />}
          {activeTab === 'reports' && <ReportsPage biddings={items} companies={companies} onRefresh={refreshData} />}
          {activeTab === 'pncp' && <PncpPage companies={companies} onRefresh={refreshData} items={items} />}
          {activeTab === 'chat-monitor' && <ChatMonitorPage companies={companies} />}
          {activeTab === 'settings' && <SettingsPage />}
        </main>
      </div>
    </ErrorBoundary>
  );
}

export default App;
