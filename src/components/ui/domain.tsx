import { useState, useEffect, type ReactNode, type HTMLAttributes } from 'react';
import {
  AlertTriangle, CheckCircle, Clock, Shield, Timer,
  ChevronRight, Bell,
} from 'lucide-react';

// ════════════════════════════════════════════════════════════════
//  LICITASAAS DOMAIN COMPONENTS
//  Componentes especialistas no domínio de licitações públicas
//  Todos usam CSS classes do design system (index.css)
// ════════════════════════════════════════════════════════════════

// ── STATUS BADGE ─────────────────────────────────────────────
// Mapeia status de licitação para variantes visuais automáticas

const STATUS_MAP: Record<string, { variant: string }> = {
  'Captado':                    { variant: 'neutral' },
  'Em Análise de Edital':       { variant: 'primary' },
  'Preparando Documentação':    { variant: 'urgency' },
  'Participando':               { variant: 'warning' },
  'Monitorando':                { variant: 'ai' },
  'Recurso':                    { variant: 'danger' },
  'Vencido':                    { variant: 'success' },
  'Perdido':                    { variant: 'danger' },
  'Sem Sucesso':                { variant: 'danger' },
};

interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: string;
  dot?: boolean;
}

export function StatusBadge({ status, dot = false, className = '', ...props }: StatusBadgeProps) {
  const m = STATUS_MAP[status] || STATUS_MAP['Captado'];
  return (
    <span className={`dom-badge dom-badge--${m.variant} ${className}`} {...props}>
      {dot && <span className="dom-badge__dot" />}
      {status}
    </span>
  );
}

// ── METRIC CARD ──────────────────────────────────────────────

interface MetricCardProps {
  title: string;
  value: string | number;
  icon?: ReactNode;
  color?: string;
  bg?: string;
  subtitle?: string;
  onClick?: () => void;
}

export function MetricCard({ title, value, icon, color = 'var(--color-primary)', bg = 'var(--color-primary-light)', subtitle, onClick }: MetricCardProps) {
  return (
    <div
      className="card card-interactive dom-metric"
      onClick={onClick}
      style={{ borderTop: `3px solid ${color}` }}
    >
      <div className="dom-metric__body">
        <div>
          <div className="dom-metric__title">{title}</div>
          <div className="dom-metric__value">{value}</div>
          {subtitle && <div className="dom-metric__sub">{subtitle}</div>}
        </div>
        {icon && (
          <div className="dom-metric__icon" style={{ color, backgroundColor: bg }}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ALERT CARD ───────────────────────────────────────────────

interface AlertCardProps {
  type: 'danger' | 'warning' | 'urgency' | 'info';
  icon?: ReactNode;
  message: string;
  action?: string;
  onClick?: () => void;
}

export function AlertCard({ type, icon, message, action, onClick }: AlertCardProps) {
  return (
    <div onClick={onClick} className={`dom-alert dom-alert--${type}${onClick ? ' dom-alert--clickable' : ''}`}>
      {icon && <div className="dom-alert__icon">{icon}</div>}
      <span className="dom-alert__msg">{message}</span>
      {action && (
        <span className="dom-alert__action">{action}</span>
      )}
    </div>
  );
}

// ── PIPELINE STEP ────────────────────────────────────────────

interface PipelineStepProps {
  label: string;
  count: number;
  icon: ReactNode;
  color: string;
  action?: string;
  onClick?: () => void;
}

export function PipelineStep({ label, count, icon, color, action, onClick }: PipelineStepProps) {
  return (
    <button onClick={onClick} className={`dom-pipeline${count > 0 ? ' dom-pipeline--active' : ''}`}>
      <div className="dom-pipeline__icon" style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
        {icon}
      </div>
      <div className="dom-pipeline__body">
        <div className="dom-pipeline__count">{count}</div>
        <div className="dom-pipeline__label">{label}</div>
      </div>
      {count > 0 && action && (
        <span className="dom-pipeline__action" style={{ color }}>{action} →</span>
      )}
    </button>
  );
}

// ── RADAR CARD ───────────────────────────────────────────────

interface RadarCardProps {
  title: string;
  value: string;
  desc: string;
  icon: ReactNode;
  color: string;
  bg: string;
  action?: string;
  onClick?: () => void;
}

export function RadarCard({ title, value, desc, icon, color, bg, action, onClick }: RadarCardProps) {
  return (
    <div className="card card-interactive dom-radar" onClick={onClick}>
      <div className="dom-radar__icon" style={{ color, backgroundColor: bg }}>{icon}</div>
      <div className="dom-radar__title">{title}</div>
      <div className="dom-radar__value">{value}</div>
      <div className="dom-radar__desc">{desc}</div>
      {action && <div className="dom-radar__action" style={{ color }}>{action} →</div>}
    </div>
  );
}

// ── MISSION CARD ─────────────────────────────────────────────

interface MissionCardProps {
  type: 'session' | 'reminder';
  time: string;
  rawDate?: string;
  title: string;
  subtitle?: string;
  onClick?: () => void;
}

export function MissionCard({ type, time, rawDate, title, subtitle, onClick }: MissionCardProps) {
  const isSession = type === 'session';
  return (
    <div onClick={onClick} className={`dom-mission dom-mission--${type}${onClick ? ' dom-mission--clickable' : ''}`}>
      <div className="dom-mission__time">{time}</div>
      <div className="dom-mission__body">
        <div className="dom-mission__title">{title}</div>
        {subtitle && <div className="dom-mission__sub">{subtitle}</div>}
      </div>
      {isSession && rawDate ? <LiveCountdown targetDate={rawDate} compact /> : (
        <span className={isSession ? 'badge badge-urgency' : 'badge badge-warning'} style={{ flexShrink: 0 }}>
          {isSession ? 'SESSÃO' : 'LEMBRETE'}
        </span>
      )}
    </div>
  );
}

// ── AGENDA ITEM ──────────────────────────────────────────────

interface AgendaItemProps {
  type: 'session' | 'reminder';
  title: string;
  time: string;
  subtitle?: string;
  onClick?: () => void;
}

export function AgendaItem({ type, title, time, subtitle, onClick }: AgendaItemProps) {
  const isSession = type === 'session';
  return (
    <div onClick={onClick} className={`dom-agenda dom-agenda--${type}${onClick ? ' dom-agenda--clickable' : ''}`}>
      <div className="dom-agenda__header">
        {isSession ? <Clock size={12} color="var(--color-danger)" /> : <Bell size={12} color="var(--color-warning)" />}
        <span className="dom-agenda__tag">
          {isSession ? 'SESSÃO' : 'LEMBRETE'} · {time}
        </span>
        {isSession && <span className="dom-agenda__link">Abrir →</span>}
      </div>
      <div className="dom-agenda__title">{title}</div>
      {subtitle && <div className="dom-agenda__sub">{subtitle}</div>}
    </div>
  );
}

// ── DOCUMENT STATUS ROW ──────────────────────────────────────

interface DocumentStatusRowProps {
  docType: string;
  status: string;
  daysLeft?: number;
  onClick?: () => void;
}

export function DocumentStatusRow({ docType, status, daysLeft, onClick }: DocumentStatusRowProps) {
  const isDanger = status === 'Vencido' || status === 'Crítico';
  const label = status === 'Vencido' ? 'Vencido' : status === 'Crítico' ? 'Crítico' : `${daysLeft}d restantes`;

  return (
    <div onClick={onClick} className={`dom-docrow dom-docrow--${isDanger ? 'danger' : 'warning'}${onClick ? ' dom-docrow--clickable' : ''}`}>
      <span className="dom-docrow__type">{docType}</span>
      <span className="dom-docrow__status">{label}</span>
    </div>
  );
}

// ── READINESS PANEL ──────────────────────────────────────────

interface ReadinessCheck {
  label: string;
  ok: boolean;
  detail?: string;
}

interface ReadinessPanelProps {
  checks: ReadinessCheck[];
  title?: string;
}

export function ReadinessPanel({ checks, title = 'Aptidão da Empresa' }: ReadinessPanelProps) {
  const allOk = checks.every(c => c.ok);
  const someOk = checks.some(c => c.ok);
  const overallStatus = allOk ? 'APTA' : someOk ? 'PARCIAL' : 'INAPTA';
  const variant = allOk ? 'success' : someOk ? 'warning' : 'danger';

  return (
    <div className="dom-readiness">
      <div className="dom-readiness__header">
        <div className="dom-readiness__title-row">
          <Shield size={16} color="var(--color-text-tertiary)" />
          <span className="dom-readiness__label">{title}</span>
        </div>
        <span className={`dom-badge dom-badge--${variant}`}>{overallStatus}</span>
      </div>
      <div className="dom-readiness__checks">
        {checks.map((check, i) => (
          <div key={i} className="dom-readiness__check">
            {check.ok
              ? <CheckCircle size={14} color="var(--color-success)" />
              : <AlertTriangle size={14} color="var(--color-warning)" />}
            <span className="dom-readiness__check-label">{check.label}</span>
            {check.detail && <span className="dom-readiness__check-detail">{check.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── NEXT STEP BANNER ─────────────────────────────────────────

interface NextStepBannerProps {
  label: string;
  desc: string;
  icon: ReactNode;
  color: string;
  onClick?: () => void;
}

export function NextStepBanner({ label, desc, icon, color, onClick }: NextStepBannerProps) {
  return (
    <div
      onClick={onClick}
      className={`dom-nextstep${onClick ? ' dom-nextstep--clickable' : ''}`}
      style={{
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 25%, transparent)`,
      }}
    >
      <div className="dom-nextstep__icon" style={{ color }}>{icon}</div>
      <div className="dom-nextstep__body">
        <div className="dom-nextstep__label" style={{ color }}>Próximo passo: {label}</div>
        <div className="dom-nextstep__desc">{desc}</div>
      </div>
      {onClick && <ChevronRight size={16} style={{ color, flexShrink: 0 }} />}
    </div>
  );
}

// ── QUICK ACTION CARD ────────────────────────────────────────

interface QuickActionProps {
  icon: ReactNode;
  label: string;
  desc?: string;
  color?: string;
  onClick?: () => void;
  disabled?: boolean;
}

export function QuickAction({ icon, label, desc, color = 'var(--color-primary)', onClick, disabled = false }: QuickActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`dom-quickaction${disabled ? ' dom-quickaction--disabled' : ''}`}
    >
      <div style={{ color, display: 'flex' }}>{icon}</div>
      <div className="dom-quickaction__label">{label}</div>
      {desc && <div className="dom-quickaction__desc">{desc}</div>}
    </button>
  );
}

// ── LIVE COUNTDOWN ───────────────────────────────────────────
// Self-refreshing countdown badge

interface LiveCountdownProps {
  targetDate: Date | string;
  compact?: boolean;
  refreshInterval?: number;
}

export function LiveCountdown({ targetDate, compact = false, refreshInterval = 60000 }: LiveCountdownProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), refreshInterval);
    return () => clearInterval(timer);
  }, [refreshInterval]);

  const target = typeof targetDate === 'string' ? new Date(targetDate) : targetDate;
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  let label: string;
  let badgeClass: string;

  if (diffMs < 0) {
    const absDays = Math.abs(Math.ceil(diffDays));
    label = compact ? `−${absDays}d` : `Vencida há ${absDays} dia${absDays !== 1 ? 's' : ''}`;
    badgeClass = 'badge badge-danger';
  } else if (diffHours < 2) {
    const mins = Math.max(0, Math.floor(diffMs / (1000 * 60)));
    label = compact ? `${mins}min` : `Em ${mins} min`;
    badgeClass = 'badge badge-danger badge-live';
  } else if (diffHours < 24) {
    const hrs = Math.floor(diffHours);
    label = compact ? `${hrs}h` : `Em ${hrs}h`;
    badgeClass = 'badge badge-danger';
  } else if (diffDays < 3) {
    const d = Math.ceil(diffDays);
    label = compact ? `${d}d` : `Em ${d} dia${d !== 1 ? 's' : ''}`;
    badgeClass = 'badge badge-warning';
  } else if (diffDays < 7) {
    const d = Math.ceil(diffDays);
    label = compact ? `${d}d` : `Em ${d} dias`;
    badgeClass = 'badge badge-info';
  } else {
    const d = Math.ceil(diffDays);
    label = compact ? `${d}d` : `Em ${d} dias`;
    badgeClass = 'badge badge-neutral';
  }

  return <span className={badgeClass}>{label}</span>;
}

// Alias for backward compatibility
export { LiveCountdown as CountdownBadge };

// ── RISK INDICATOR ───────────────────────────────────────────

interface RiskIndicatorProps {
  risk: 'Baixo' | 'Médio' | 'Alto' | 'Crítico' | string;
  compact?: boolean;
}

export function RiskIndicator({ risk, compact = false }: RiskIndicatorProps) {
  const variant = (risk === 'Alto' || risk === 'Crítico') ? 'danger' : risk === 'Médio' ? 'warning' : 'success';
  const icon = variant === 'success' ? <CheckCircle size={12} /> : <AlertTriangle size={12} />;

  return (
    <span className={`dom-badge dom-badge--${variant}`}>
      {icon}
      {!compact && ` Risco ${risk}`}
      {compact && ` ${risk}`}
    </span>
  );
}

// ── SESSION STATUS CHIP ──────────────────────────────────────

interface SessionStatusChipProps {
  status: 'upcoming' | 'live' | 'finished' | 'cancelled';
  label?: string;
}

export function SessionStatusChip({ status, label }: SessionStatusChipProps) {
  const cfg = {
    upcoming: { badge: 'badge badge-info', text: label || 'Agendada' },
    live:     { badge: 'badge badge-danger badge-live', text: label || 'AO VIVO' },
    finished: { badge: 'badge badge-success', text: label || 'Encerrada' },
    cancelled:{ badge: 'badge badge-neutral', text: label || 'Cancelada' },
  }[status];

  return <span className={cfg.badge}>{cfg.text}</span>;
}

// ── DEADLINE INDICATOR ───────────────────────────────────────

interface DeadlineIndicatorProps {
  date: Date | string;
  label?: string;
}

export function DeadlineIndicator({ date, label }: DeadlineIndicatorProps) {
  const target = typeof date === 'string' ? new Date(date) : date;
  const diffDays = Math.ceil((target.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  const variant = diffDays < 0 ? 'danger' : diffDays < 3 ? 'danger' : diffDays < 7 ? 'warning' : 'neutral';
  const icon = diffDays < 3 ? <Timer size={12} /> : <Clock size={12} />;

  return (
    <span className={`dom-deadline dom-deadline--${variant}`}>
      {icon}
      {label || (diffDays < 0 ? `Vencido há ${Math.abs(diffDays)}d` : `${diffDays}d restante${diffDays !== 1 ? 's' : ''}`)}
    </span>
  );
}

// ── PROCESS ACTION BAR ───────────────────────────────────────
// Barra de ações rápidas na lateral ou topo do detalhe de processo

interface ProcessAction {
  icon: ReactNode;
  label: string;
  color?: string;
  disabled?: boolean;
  onClick: () => void;
}

interface ProcessActionBarProps {
  actions: ProcessAction[];
  direction?: 'row' | 'column';
}

export function ProcessActionBar({ actions, direction = 'row' }: ProcessActionBarProps) {
  return (
    <div className={`dom-actionbar dom-actionbar--${direction}`}>
      {actions.map((a, i) => (
        <button
          key={i}
          onClick={a.onClick}
          disabled={a.disabled}
          className={`dom-actionbar__btn${a.disabled ? ' dom-actionbar__btn--disabled' : ''}`}
          title={a.label}
        >
          <span style={{ color: a.color || 'var(--color-primary)', display: 'flex' }}>{a.icon}</span>
          <span className="dom-actionbar__label">{a.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── TIMELINE EVENT ───────────────────────────────────────────
// Evento de timeline para histórico de processo / observações

interface TimelineEventProps {
  date: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  type?: 'info' | 'success' | 'warning' | 'danger' | 'ai';
}

export function TimelineEvent({ date, title, description, icon, type = 'info' }: TimelineEventProps) {
  return (
    <div className="dom-timeline">
      <div className={`dom-timeline__dot dom-timeline__dot--${type}`}>
        {icon || <div className="dom-timeline__dot-inner" />}
      </div>
      <div className="dom-timeline__content">
        <div className="dom-timeline__header">
          <span className="dom-timeline__title">{title}</span>
          <span className="dom-timeline__date">{date}</span>
        </div>
        {description && <div className="dom-timeline__desc">{description}</div>}
      </div>
    </div>
  );
}

// ── SECTION DIVIDER ──────────────────────────────────────────

interface SectionDividerProps {
  icon?: ReactNode;
  title: string;
  action?: ReactNode;
}

export function SectionDivider({ icon, title, action }: SectionDividerProps) {
  return (
    <div className="dom-section-divider">
      <div className="dom-section-divider__left">
        {icon}
        <span className="dom-section-divider__title">{title}</span>
      </div>
      {action}
    </div>
  );
}

// ── AI METRIC SNIPPET ────────────────────────────────────────

interface AiMetricProps {
  value: number | string;
  label: string;
  color?: string;
}

export function AiMetric({ value, label, color = 'var(--color-primary)' }: AiMetricProps) {
  return (
    <div className="dom-aimetric">
      <div className="dom-aimetric__value" style={{ color }}>{value}</div>
      <div className="dom-aimetric__label">{label}</div>
    </div>
  );
}

// ── PROGRESS BAR ─────────────────────────────────────────────

interface ProgressBarProps {
  value: number;
  max?: number;
  color?: string;
  height?: number;
  label?: string;
}

export function ProgressBar({ value, max = 100, color, height = 8, label }: ProgressBarProps) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const barColor = color || (pct >= 100 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-primary)' : 'var(--color-warning)');

  return (
    <div>
      <div className="dom-progress" style={{ height }}>
        <div className="dom-progress__fill" style={{ width: `${pct}%`, background: barColor }} />
      </div>
      {label && <div className="dom-progress__label">{label}</div>}
    </div>
  );
}
