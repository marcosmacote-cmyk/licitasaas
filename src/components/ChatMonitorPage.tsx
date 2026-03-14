import { MessageSquare, Search, RefreshCw, Loader2, RadioTower, Gavel, Building2, User, Cpu, Pin, Archive, ArchiveRestore, CheckCheck, Settings, Save, Bell, Phone, Send, SignalHigh, CheckCircle, XCircle, AlertTriangle, Info, Wifi, WifiOff } from 'lucide-react';
import { useChatMonitor } from './hooks/useChatMonitor';
import type { TabFilter } from './hooks/useChatMonitor';

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

interface Props {
  companies: { id: string; name?: string; cnpj?: string; }[];
}

export function ChatMonitorPage({ companies }: Props) {
  const c = useChatMonitor({ companies });

  if (c.loadingProcesses) {
    return (
      <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Loader2 size={32} className="spinner" color="var(--color-primary)" />
      </div>
    );
  }

  return (
    <div className="page-container" style={{ padding: 0, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
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
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-base)', flexShrink: 0, display: 'grid', gap: 'var(--space-4)', maxHeight: '300px', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)', alignItems: 'end' }}>
            <div>
              <label className="config-label"><Bell size={12} /> Palavras-chave de Alerta</label>
              <input type="text" className="config-input" value={c.monitorConfig.keywords}
                onChange={(e) => c.setMonitorConfig({...c.monitorConfig, keywords: e.target.value})}
                placeholder="suspensa, reaberta, vencedora..." />
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
                    className={`chat-process-item${isSelected ? ' active' : ''}`}>
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

                    {/* Message count + unread badge + link warning */}
                    <div style={{ marginTop: '6px', display: 'flex', gap: '8px', fontSize: '0.6875rem', color: 'var(--color-text-tertiary)', alignItems: 'center' }}>
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
