import { MessageSquare, Search, RefreshCw, Loader2, RadioTower, Gavel, Building2, User, Cpu, Pin, Archive, ArchiveRestore, CheckCheck, Settings, Save, Bell, Phone, Send, SignalHigh, CheckCircle, XCircle, AlertTriangle, Info, Wifi, WifiOff, ExternalLink, X, Plus, BellRing, Trophy, Timer, FileClock, Ban, RotateCcw, Scale, UserX, MessageSquareMore, Megaphone, CalendarClock, Lock, EyeOff } from 'lucide-react';
import { useState as useLocalState } from 'react';
import { useChatMonitor } from './hooks/useChatMonitor';
import type { TabFilter } from './hooks/useChatMonitor';
import { BackToHubBanner } from './ui/BackToHubBanner';
import { GovernanceBlockedBanner } from './ui/GovernanceBlockedBanner';
import { resolveStage, isModuleAllowed } from '../governance';
import type { BiddingProcess } from '../types';

// ── Keyword highlight helper ──
function highlightKeywords(text: string, keyword: string | null) {
  if (!keyword) return text;
  const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} style={{ background: 'var(--color-warning-bg)', padding: '1px 3px', borderRadius: 'var(--radius-sm)', fontWeight: 'var(--font-semibold)' }}>{part}</mark>
      : part
  );
}

// ── Severity styles ──
const severityConfig: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string; border: string }> = {
  critical: { label: 'Crítico', icon: <XCircle size={14} />, color: '#dc2626', bg: 'rgba(220, 38, 38, 0.06)', border: 'rgba(220, 38, 38, 0.15)' },
  warning: { label: 'Atenção', icon: <AlertTriangle size={14} />, color: '#d97706', bg: 'rgba(217, 119, 6, 0.06)', border: 'rgba(217, 119, 6, 0.15)' },
  info: { label: 'Informativo', icon: <Info size={14} />, color: '#6b7280', bg: 'rgba(107, 114, 128, 0.06)', border: 'rgba(107, 114, 128, 0.15)' },
  closure: { label: 'Encerramento', icon: <Lock size={14} />, color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.06)', border: 'rgba(124, 58, 237, 0.15)' },
};

// ── Category icon map ──
const CATEGORY_ICONS: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  'bell-ring': BellRing,
  'trophy': Trophy,
  'timer': Timer,
  'file-clock': FileClock,
  'ban': Ban,
  'rotate-ccw': RotateCcw,
  'scale': Scale,
  'user-x': UserX,
  'message-square-more': MessageSquareMore,
  'megaphone': Megaphone,
  'calendar-clock': CalendarClock,
  'lock': Lock,
};

function CategoryIcon({ icon, size = 14, color }: { icon: string; size?: number; color?: string }) {
  const IconComp = CATEGORY_ICONS[icon];
  if (!IconComp) return null;
  return <IconComp size={size} color={color} />;
}

// ── Author icon helper ──
function AuthorIcon({ type }: { type: string | null }) {
  if (type === 'pregoeiro') return <Gavel size={14} />;
  if (type === 'sistema') return <Cpu size={14} />;
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
  if (type === 'pregoeiro') return { bg: 'var(--color-primary-light)', border: 'rgba(37, 99, 235, 0.15)', text: 'var(--color-primary)' };
  if (type === 'sistema') return { bg: 'var(--color-warning-bg)', border: 'rgba(245, 158, 11, 0.15)', text: 'var(--color-warning)' };
  if (type === 'fornecedor') return { bg: 'var(--color-neutral-bg)', border: 'rgba(100, 116, 139, 0.12)', text: 'var(--color-neutral)' };
  return { bg: 'var(--color-bg-surface)', border: 'var(--color-border)', text: 'var(--color-text-secondary)' };
}

function portalBadge(portal: string) {
  const p = (portal || '').toLowerCase();
  if (p.includes('compras') || p.includes('cnet')) return { label: 'ComprasNet', color: 'var(--color-success)', bg: 'var(--color-success-bg)' };
  if (p.includes('pncp')) return { label: 'PNCP', color: 'var(--color-primary)', bg: 'var(--color-primary-light)' };
  if (p.includes('bll')) return { label: 'BLL', color: 'var(--color-warning)', bg: 'var(--color-warning-bg)' };
  return { label: portal || 'Outro', color: 'var(--color-neutral)', bg: 'var(--color-neutral-bg)' };
}

// ── Custom Keyword Input (with Enter support) ──
function CustomKeywordInput({ onAdd }: { onAdd: (kw: string) => void }) {
  const [value, setValue] = useLocalState('');
  const handleAdd = () => { if (value.trim()) { onAdd(value); setValue(''); } };
  return (
    <div style={{ display: 'flex', gap: '4px' }}>
      <input type="text" className="config-input" value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
        placeholder="Adicionar keyword..." style={{ flex: 1 }} />
      <button onClick={handleAdd} className="btn btn-ghost"
        style={{ padding: '4px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 'var(--text-sm)' }}>
        <Plus size={14} />
      </button>
    </div>
  );
}

// ── Category Custom Keyword Input (inline, per category) ──
function CategoryKeywordInput({ catId, onAdd, color }: { catId: string; onAdd: (catId: string, kw: string) => void; color: string }) {
  const [value, setValue] = useLocalState('');
  const handleAdd = () => { if (value.trim()) { onAdd(catId, value); setValue(''); } };
  return (
    <div style={{ display: 'flex', gap: '3px', alignItems: 'center', flex: '1 1 auto', maxWidth: '200px' }}>
      <input type="text" value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
        placeholder="+ palavra..."
        style={{
          flex: 1, padding: '2px 6px', borderRadius: 'var(--radius-sm)',
          border: `1px solid ${color}22`, background: 'white',
          fontSize: '0.6875rem', color: 'var(--color-text-primary)', outline: 'none',
          minWidth: '80px',
        }} />
      <button onClick={handleAdd}
        style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', display: 'flex', lineHeight: 1 }}>
        <Plus size={12} color={color} />
      </button>
    </div>
  );
}

interface Props {
  companies: { id: string; name?: string; cnpj?: string; }[];
  biddings?: BiddingProcess[];
  hubOriginId?: string;
  onReturnToHub?: (processId: string) => void;
  onNavigateToHub?: (processId: string) => void;
}

export function ChatMonitorPage({ companies, biddings, hubOriginId, onReturnToHub, onNavigateToHub }: Props) {
  const c = useChatMonitor({ companies });

  // ── Governance check ──
  const hubProcess = hubOriginId && biddings ? biddings.find(b => b.id === hubOriginId) : undefined;
  if (hubProcess) {
    const stage = resolveStage(hubProcess.status);
    if (!isModuleAllowed(stage, hubProcess.substage, 'monitoring')) {
      return (
        <div className="page-container" style={{ padding: 'var(--space-6)' }}>
          {onReturnToHub && (
            <BackToHubBanner
              processTitle={hubProcess.title}
              onReturn={() => onReturnToHub(hubOriginId!)}
            />
          )}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <GovernanceBlockedBanner
              processStatus={hubProcess.status}
              substage={hubProcess.substage}
              module="monitoring"
              processTitle={hubProcess.title}
              onGoToHub={onReturnToHub ? () => onReturnToHub(hubOriginId!) : undefined}
            />
          </div>
        </div>
      );
    }
  }

  if (c.loadingProcesses) {
    return (
      <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Loader2 size={32} className="spinner" color="var(--color-primary)" />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ padding: 0, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      {/* Back to Hub */}
      {hubOriginId && onReturnToHub && (
        <div style={{ padding: 'var(--space-3) var(--space-4)', flexShrink: 0 }}>
          <BackToHubBanner
            onReturn={() => onReturnToHub(hubOriginId)}
          />
        </div>
      )}
      {/* ── Top Bar ── */}
      <div className="chat-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <RadioTower size={22} color="var(--color-success)" />
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-bold)', margin: 0 }}>Monitor de Chat</h1>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 'var(--space-4)', marginLeft: 'var(--space-6)' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
            {c.totalProcesses} {c.totalProcesses === 1 ? 'processo' : 'processos'} · {c.totalMessages} {c.totalMessages === 1 ? 'mensagem' : 'mensagens'}
          </span>
          {c.importantCount > 0 && (
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-warning)', fontWeight: 'var(--font-semibold)' }}>
              {c.importantCount} com alertas
            </span>
          )}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {c.refreshing && <Loader2 size={14} className="spinner" color="var(--color-text-tertiary)" />}

          {/* ComprasNet Watcher Status Indicator */}
          {c.watcherStatus && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-sm)', color: c.watcherStatus.isOnline ? 'var(--color-success)' : 'var(--color-text-tertiary)', padding: '4px var(--space-3)', borderRadius: 'var(--radius-sm)', background: c.watcherStatus.isOnline ? 'var(--color-success-bg)' : 'var(--color-bg-surface-hover)', border: '1px solid ' + (c.watcherStatus.isOnline ? 'rgba(16, 185, 129, 0.2)' : 'var(--color-border)') }}>
              {c.watcherStatus.isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
              {c.watcherStatus.isOnline ? `Agente ativo (${c.watcherStatus.activeSessions || 0} abas)` : 'Agente offline'}
            </div>
          )}

          <button className="btn btn-ghost" onClick={() => c.fetchProcesses(true)} title="Atualizar" style={{ padding: '6px' }}>
            <RefreshCw size={16} />
          </button>
          <button className="btn btn-ghost" onClick={() => c.setShowConfig(!c.showConfig)} title="Configurações do Monitor" style={{ padding: '6px', color: c.showConfig ? 'var(--color-primary)' : undefined }}>
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* ── Config Panel (collapsible) ── */}
      {c.showConfig && (
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-base)', flexShrink: 0, display: 'grid', gap: 'var(--space-4)', maxHeight: '500px', overflowY: 'auto' }}>

          {/* ── Alert Categories ── */}
          {c.taxonomy && (
            <div>
              <label className="config-label" style={{ marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Bell size={12} /> Categorias de Alerta
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {(['critical', 'warning', 'info'] as const).map(severity => {
                  const sc = severityConfig[severity];
                  const cats = c.taxonomy.categories.filter((cat: any) => cat.severity === severity);
                  if (cats.length === 0) return null;
                  return (
                    <div key={severity} style={{ padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', background: sc.bg, border: `1px solid ${sc.border}` }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: sc.color, marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {sc.icon} {sc.label}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        {cats.map((cat: any) => {
                          const isEnabled = c.enabledCategories.includes(cat.id);
                          const catKws = c.categoryCustomKeywords[cat.id] || [];
                          return (
                            <div key={cat.id}>
                              {/* Checkbox row */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <label
                                  title={cat.description}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                                    background: isEnabled ? 'white' : 'transparent',
                                    border: `1px solid ${isEnabled ? sc.border : 'transparent'}`,
                                    cursor: 'pointer', fontSize: 'var(--text-sm)',
                                    color: isEnabled ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                                    transition: 'var(--transition-fast)',
                                    boxShadow: isEnabled ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                                    flex: '0 0 auto',
                                  }}>
                                  <input type="checkbox" checked={isEnabled}
                                    onChange={() => c.toggleCategory(cat.id)}
                                    style={{ accentColor: sc.color, width: '14px', height: '14px' }} />
                                  <CategoryIcon icon={cat.icon} size={14} color={isEnabled ? sc.color : 'var(--color-text-tertiary)'} />
                                  <span>{cat.label}</span>
                                </label>
                                {/* Keyword tags inline */}
                                {isEnabled && catKws.length > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center' }}>
                                    {catKws.map(kw => (
                                      <span key={kw} style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '3px',
                                        padding: '1px 6px', borderRadius: 'var(--radius-lg)',
                                        background: 'white', border: `1px solid ${sc.border}`,
                                        fontSize: '0.6875rem', color: sc.color, fontWeight: 600,
                                      }}>
                                        {kw}
                                        <button onClick={() => c.removeCategoryKeyword(cat.id, kw)}
                                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', lineHeight: 1 }}>
                                          <X size={10} color={sc.color} />
                                        </button>
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {/* Inline add input */}
                                {isEnabled && (
                                  <CategoryKeywordInput catId={cat.id} onAdd={c.addCategoryKeyword} color={sc.color} />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Custom Keywords + Channels ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
            <div>
              <label className="config-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Plus size={12} /> Palavras-chave Personalizadas
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: 'var(--space-2)', minHeight: '28px' }}>
                {c.customKeywords.map(kw => (
                  <span key={kw} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    padding: '2px 8px', borderRadius: 'var(--radius-lg)',
                    background: 'var(--color-primary-light)', color: 'var(--color-primary)',
                    fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)',
                  }}>
                    {kw}
                    <button onClick={() => c.removeCustomKeyword(kw)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', lineHeight: 1 }}>
                      <X size={12} color="var(--color-primary)" />
                    </button>
                  </span>
                ))}
              </div>
              <CustomKeywordInput onAdd={c.addCustomKeyword} />
            </div>
            <div>
              <label className="config-label"><Phone size={12} color="var(--color-success)" /> WhatsApp</label>
              <input type="text" className="config-input" value={c.monitorConfig.phoneNumber}
                onChange={(e) => c.setMonitorConfig({...c.monitorConfig, phoneNumber: e.target.value})}
                placeholder="+5585999999999" />
            </div>
            <div>
              <label className="config-label"><Send size={12} color="var(--color-primary)" /> Telegram Chat ID</label>
              <input type="text" className="config-input" value={c.monitorConfig.telegramChatId}
                onChange={(e) => c.setMonitorConfig({...c.monitorConfig, telegramChatId: e.target.value})}
                placeholder="Chat ID ou @usuario" />
            </div>
          </div>

          {/* ── Actions Row ── */}
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
              <button className="btn btn-ghost"
                style={{ padding: '6px 14px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', gap: 'var(--space-2)', border: '1px solid var(--color-border)' }}
                disabled={c.testingNotif} onClick={c.handleTestNotification}>
                {c.testingNotif ? <Loader2 size={12} className="spinner" /> : <SignalHigh size={12} />}
                Testar
              </button>
              <button className="btn btn-primary"
                style={{ padding: '6px var(--space-4)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', gap: 'var(--space-2)' }}
                disabled={c.savingConfig} onClick={c.handleSaveConfig}>
                {c.savingConfig ? <Loader2 size={12} className="spinner" /> : <Save size={12} />}
                Salvar
              </button>
            </div>
            {c.health && (
              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {c.health.lastPollStatus === 'success' ? <CheckCircle size={12} color="var(--color-success)" /> : c.health.lastPollStatus === 'error' ? <XCircle size={12} color="var(--color-danger)" /> : <AlertTriangle size={12} color="var(--color-warning)" />}
                  {c.health.lastPollTime ? new Date(c.health.lastPollTime).toLocaleString('pt-BR') : 'Aguardando...'}
                </div>
                <span>{c.health.monitoredProcesses || 0} monitorados</span>
                <span>{c.health.totalAlerts || 0} alertas</span>
              </div>
            )}
          </div>
          {/* ComprasNet Watcher Status */}
          <div style={{ padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(16, 185, 129, 0.15)', background: 'var(--color-success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {c.watcherStatus?.isOnline ? <Wifi size={14} color="var(--color-success)" /> : <WifiOff size={14} color="var(--color-text-tertiary)" />}
              <div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-primary)' }}>
                  Agente Local (ComprasNet)
                </div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                  {c.watcherStatus?.isOnline
                    ? `Sincronizado: ${c.watcherStatus.machineName} (${c.watcherStatus.activeSessions || 0} abas)`
                    : 'Offline — inicie o agente na sua máquina'}
                </div>
              </div>
            </div>
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Info size={10} /> Ative o monitoramento [SignalHigh] no Kanban para que o agente local (ou o servidor PNCP) monitore o processo.
          </div>
        </div>
      )}

      {/* ── Split Panel ── */}
      <div className="chat-split-panel">

        {/* ── LEFT: Process List ── */}
        <div className="chat-sidebar">

          {/* Filters */}
          <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {/* Search */}
            <div className="pos-relative">
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
              <input type="text" placeholder="Buscar por edital, nº processo, UASG..."
                value={c.searchQuery} onChange={(e) => c.setSearchQuery(e.target.value)}
                style={{ width: '100%', padding: 'var(--space-2) var(--space-3) var(--space-2) var(--space-8)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', fontSize: 'var(--text-md)', color: 'var(--color-text-primary)', outline: 'none' }} />
            </div>

            {/* Dropdowns Row */}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <select value={c.companyFilter} onChange={(e) => c.setCompanyFilter(e.target.value)}
                style={{ flex: 1, padding: '6px var(--space-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                <option value="all">Todas empresas</option>
                {companies.map(cp => (<option key={cp.id} value={cp.id}>{cp.name}</option>))}
              </select>
              <select value={c.platformFilter} onChange={(e) => c.setPlatformFilter(e.target.value)}
                style={{ flex: 1, padding: '6px var(--space-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                <option value="all">Todas plataformas</option>
                <option value="comprasnet">ComprasNet</option>
                <option value="pncp">PNCP</option>
                <option value="bll">BLL</option>
              </select>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '4px' }}>
              {([
                { key: 'all' as TabFilter, label: 'Todos', count: c.totalProcesses },
                { key: 'unread' as TabFilter, label: 'Não lidos', count: c.unreadProcessCount },
                { key: 'important' as TabFilter, label: 'Importantes', count: c.importantCount },
                { key: 'archived' as TabFilter, label: 'Arquivados', count: c.archivedCount },
              ]).map(tab => (
                <button key={tab.key} onClick={() => c.setActiveTab(tab.key)}
                  style={{
                    flex: 1, padding: '6px var(--space-3)', borderRadius: 'var(--radius-sm)', border: 'none',
                    fontSize: 'var(--text-sm)', fontWeight: c.activeTab === tab.key ? 'var(--font-semibold)' : 'var(--font-normal)',
                    background: c.activeTab === tab.key ? 'var(--color-primary)' : 'var(--color-bg-surface)',
                    color: c.activeTab === tab.key ? 'white' : 'var(--color-text-secondary)',
                    cursor: 'pointer', transition: 'var(--transition-fast)',
                  }}>
                  {tab.label} {tab.count > 0 && <span style={{ opacity: 0.7 }}>({tab.count})</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Process List */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {c.filteredProcesses.length === 0 ? (
              <div style={{ padding: 'var(--space-10) var(--space-5)', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-md)' }}>
                <MessageSquare size={32} style={{ marginBottom: 'var(--space-3)', opacity: 0.3 }} />
                <p>Nenhuma mensagem capturada ainda.</p>
                <p style={{ fontSize: '0.75rem', marginTop: '8px' }}>Ative o monitoramento nos cards de licitação.</p>
              </div>
            ) : (
              c.filteredProcesses.map(proc => {
                const isSelected = proc.id === c.selectedProcessId;
                const badge = portalBadge(proc.portal);
                const company = companies.find(cp => cp.id === proc.companyProfileId);
                const preview = proc.lastMessage?.content?.substring(0, 80) || '';
                const lastMsgDate = proc.lastMessage?.createdAt;

                return (
                  <div key={proc.id} onClick={() => c.handleSelectProcess(proc.id)}
                    onDoubleClick={() => onNavigateToHub?.(proc.id)}
                    className={`chat-process-item${isSelected ? ' active' : ''}`}
                    title="Duplo clique para abrir o HUB do processo">
                    {/* Title + Badge */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '0.8125rem', fontWeight: proc.unreadCount > 0 ? 700 : 600, color: 'var(--color-text-primary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '1.3' }}>
                        {proc.isImportant && <span style={{ color: 'var(--color-warning)', marginRight: '4px', fontWeight: 700, fontSize: '0.7rem', letterSpacing: '0.05em' }}>ALERTA</span>}
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

                    {/* Message count + unread badge + link warning + remove monitoring */}
                    <div style={{ marginTop: '6px', display: 'flex', gap: '8px', fontSize: '0.6875rem', color: 'var(--color-text-tertiary)', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {(proc as any).hasPncpLink === false && proc.totalMessages === 0 ? (
                          <span style={{ color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <AlertTriangle size={10} /> Sem link PNCP — edite o processo
                          </span>
                        ) : (
                          <>
                            <span>{proc.totalMessages} msgs</span>
                            {proc.unreadCount > 0 && (
                              <span style={{ padding: '1px 6px', borderRadius: 'var(--radius-lg)', background: 'var(--color-primary)', color: 'white', fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-xs)' }}>
                                {proc.unreadCount} novas
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      <button
                        title="Remover monitoramento"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Deseja remover o monitoramento do processo "${proc.title.substring(0, 50)}..."?\n\nO status do processo NÃO será alterado.`)) {
                            c.removeMonitoring(proc.id);
                          }
                        }}
                        style={{
                          padding: '3px', borderRadius: 'var(--radius-sm)', border: 'none',
                          background: 'transparent', cursor: 'pointer', display: 'flex',
                          alignItems: 'center', opacity: 0.4, transition: 'var(--transition-fast)',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(220, 38, 38, 0.08)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.4'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                      >
                        <EyeOff size={13} color="var(--color-danger, #dc2626)" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── RIGHT: Chat Messages ── */}
        <div className="chat-main">
          {c.selectedProc ? (
            <>
              {/* Process Header */}
              <div className="chat-topbar">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', margin: '0 0 4px 0', color: 'var(--color-text-primary)' }}>
                      {c.selectedProc.title}
                    </h2>
                    <div style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                      {c.selectedProc.uasg && <span>UASG: {c.selectedProc.uasg}</span>}
                      {c.selectedProc.modality && <span>{c.selectedProc.modality}</span>}
                      <span>{portalBadge(c.selectedProc.portal).label}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <span style={{ fontSize: 'var(--text-sm)', padding: '4px var(--space-3)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-surface-hover)', color: 'var(--color-text-secondary)' }}>
                      {c.selectedProc.totalMessages} mensagens
                    </span>
                    {onNavigateToHub && (
                      <button title="Abrir HUB do processo"
                        onClick={() => onNavigateToHub(c.selectedProc!.id)}
                        style={{ padding: '4px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-primary)', background: 'var(--color-primary-light)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-sm)', color: 'var(--color-primary)', fontWeight: 600 }}>
                        <ExternalLink size={13} /> HUB
                      </button>
                    )}
                    <button title={c.selectedProc.isImportant ? 'Remover destaque' : 'Marcar como importante'}
                      onClick={(e) => { e.stopPropagation(); c.toggleProcessImportant(c.selectedProc!.id, c.selectedProc!.isImportant); }}
                      style={{ padding: '4px', borderRadius: 'var(--radius-sm)', border: 'none', background: c.selectedProc.isImportant ? 'var(--color-warning-bg)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                      <Pin size={16} fill={c.selectedProc.isImportant ? 'var(--color-warning)' : 'none'} color={c.selectedProc.isImportant ? 'var(--color-warning)' : 'var(--color-text-tertiary)'} />
                    </button>
                    <button title={c.selectedProc.isArchived ? 'Desarquivar' : 'Arquivar'}
                      onClick={(e) => { e.stopPropagation(); c.toggleProcessArchive(c.selectedProc!.id, c.selectedProc!.isArchived); }}
                      style={{ padding: '4px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                      {c.selectedProc.isArchived ? <ArchiveRestore size={16} color="var(--color-text-tertiary)" /> : <Archive size={16} color="var(--color-text-tertiary)" />}
                    </button>
                    <button title="Marcar tudo como lido" onClick={() => c.markProcessRead(c.selectedProc!.id)}
                      style={{ padding: '4px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                      <CheckCheck size={16} color="var(--color-text-tertiary)" />
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Closure Banner ── */}
              {c.selectedProc.closureDetected && (
                <div style={{
                  margin: '0 var(--space-4)',
                  padding: 'var(--space-3) var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  background: 'linear-gradient(135deg, rgba(220, 38, 38, 0.08), rgba(217, 119, 6, 0.08))',
                  border: '1px solid rgba(220, 38, 38, 0.2)',
                  display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                  flexWrap: 'wrap',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '200px' }}>
                    <div style={{
                      width: '32px', height: '32px', borderRadius: 'var(--radius-md)',
                      background: 'rgba(220, 38, 38, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <AlertTriangle size={18} color="#dc2626" />
                    </div>
                    <div>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-bold)', color: '#dc2626' }}>
                        Processo Encerrado
                      </div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-secondary)' }}>
                        Detectado: <strong>{c.selectedProc.closureDetected}</strong> — Deseja encerrar o monitoramento?
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button
                      onClick={() => c.handleClosureAction(c.selectedProc!.id, 'lost')}
                      style={{
                        padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid #dc2626',
                        background: '#dc2626', color: 'white', cursor: 'pointer',
                        fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px',
                      }}>
                      <XCircle size={13} /> Perdido
                    </button>
                    <button
                      onClick={() => c.handleClosureAction(c.selectedProc!.id, 'archived')}
                      style={{
                        padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
                        background: 'var(--color-bg-surface)', color: 'var(--color-text-secondary)', cursor: 'pointer',
                        fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px',
                      }}>
                      <Archive size={13} /> Arquivar
                    </button>
                    <button
                      onClick={() => c.handleClosureAction(c.selectedProc!.id, 'dismiss')}
                      style={{
                        padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid transparent',
                        background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer',
                        fontSize: '0.75rem', fontWeight: 500,
                      }}>
                      Manter
                    </button>
                  </div>
                </div>
              )}

              {/* Messages Area */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4) var(--space-6)' }}>
                {c.loadingMessages ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
                    <Loader2 size={24} className="spinner" color="var(--color-text-tertiary)" />
                  </div>
                ) : (
                  <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {c.selectedMessages.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-md)' }}>
                        <MessageSquare size={32} style={{ marginBottom: 'var(--space-2)', opacity: 0.3 }} />
                        <p>Nenhuma mensagem capturada para este processo.</p>
                      </div>
                    ) : (
                      c.selectedMessages.map(msg => {
                        const colors = authorColor(msg.authorType);
                        const hasKeyword = !!msg.detectedKeyword;

                        return (
                          <div key={msg.id} style={{
                            padding: 'var(--space-4) var(--space-5)', borderRadius: 'var(--radius-lg)',
                            background: colors.bg,
                            border: `1px solid ${hasKeyword ? 'rgba(245, 158, 11, 0.3)' : colors.border}`,
                            boxShadow: hasKeyword ? '0 0 0 1px rgba(245, 158, 11, 0.1)' : 'none',
                          }}>
                            {/* Author Header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: colors.text, fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)' }}>
                                <AuthorIcon type={msg.authorType} />
                                <span>{authorLabel(msg.authorType)}</span>
                                {msg.itemRef && (
                                  <span style={{ padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.05)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-normal)' }}>
                                    Item {msg.itemRef}
                                  </span>
                                )}
                                {hasKeyword && (
                                  <span style={{ padding: '1px var(--space-2)', borderRadius: 'var(--radius-lg)', background: 'var(--color-warning-bg)', color: 'var(--color-warning)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)' }}>
                                    {msg.detectedKeyword}
                                  </span>
                                )}
                              </div>
                              <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-tertiary)' }}>
                                {new Date(msg.createdAt).toLocaleDateString('pt-BR')} {new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>

                            {/* Message Content */}
                            <div style={{ fontSize: 'var(--text-md)', lineHeight: 1.6, color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>
                              {highlightKeywords(msg.content, msg.detectedKeyword)}
                            </div>

                            {/* Source badge */}
                            {msg.captureSource && (
                              <div style={{ marginTop: 'var(--space-2)', display: 'flex', justifyContent: 'flex-end' }}>
                                <span style={{ fontSize: 'var(--text-xs)', padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.04)', color: 'var(--color-text-tertiary)' }}>
                                  via {msg.captureSource === 'comprasnet-xhr' ? 'ComprasNet' : msg.captureSource === 'pncp-status' ? 'PNCP' : msg.captureSource}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                    <div ref={c.messagesEndRef} />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state--centered">
              <RadioTower size={48} style={{ opacity: 0.2 }} />
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Selecione um processo</p>
                <p style={{ fontSize: 'var(--text-md)' }}>Escolha um processo na lista à esquerda para ver as mensagens do chat.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
