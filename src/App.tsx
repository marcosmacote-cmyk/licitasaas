import { useState, useEffect } from 'react';
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
  Loader2
} from 'lucide-react';
import { BiddingPage } from './components/BiddingPage';
import { Dashboard } from './components/Dashboard';
import { DocumentsPage } from './components/DocumentsPage';
import { ReportsPage } from './components/ReportsPage';
import { LoginPage } from './components/LoginPage';
import type { BiddingProcess, CompanyProfile } from './types';
import { API_BASE_URL } from './config';

function App() {
  const [user, setUser] = useState<any>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'bidding' | 'documents' | 'reports'>('dashboard');
  const [items, setItems] = useState<BiddingProcess[]>([]);
  const [companies, setCompanies] = useState<CompanyProfile[]>([]);
  const [loading, setLoading] = useState(true);

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
          <a href="#" className={`nav-item ${activeTab === 'reports' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('reports'); }}>
            <PieChart size={20} />
            <span>Relatórios</span>
          </a>
          <div style={{ flex: 1 }}></div>
          <a href="#" className="nav-item">
            <Settings size={20} />
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
      </main>
    </div>
  );
}

export default App;
