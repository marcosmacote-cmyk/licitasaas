import type { ReactNode, HTMLAttributes } from 'react';

// ════════════════════════════════════════
//  SECTION HEADER — LicitaSaaS Design System
// ════════════════════════════════════════

interface SectionHeaderProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
  title: string;
  badge?: ReactNode;
  action?: ReactNode;
}

export function SectionHeader({ icon, title, badge, action, style, ...props }: SectionHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-4)',
        ...style,
      }}
      {...props}
    >
      <h3
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          fontSize: 'var(--text-md)',
          fontWeight: 'var(--font-semibold)',
          color: 'var(--color-text-primary)',
          margin: 0,
        }}
      >
        {icon}
        {title}
        {badge}
      </h3>
      {action}
    </div>
  );
}

// ════════════════════════════════════════
//  EMPTY STATE — LicitaSaaS Design System
// ════════════════════════════════════════

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: 'var(--space-10) var(--space-6)',
        color: 'var(--color-text-tertiary)',
      }}
    >
      {icon && (
        <div style={{ marginBottom: 'var(--space-3)', opacity: 0.4, display: 'flex', justifyContent: 'center' }}>
          {icon}
        </div>
      )}
      <p style={{ fontWeight: 'var(--font-medium)', fontSize: 'var(--text-md)', color: 'var(--color-text-secondary)', margin: 0 }}>
        {title}
      </p>
      {description && (
        <p style={{ fontSize: 'var(--text-base)', marginTop: 'var(--space-2)', color: 'var(--color-text-tertiary)' }}>
          {description}
        </p>
      )}
      {action && <div style={{ marginTop: 'var(--space-4)' }}>{action}</div>}
    </div>
  );
}

// ════════════════════════════════════════
//  TABS — LicitaSaaS Design System
// ════════════════════════════════════════

interface Tab {
  key: string;
  label: string;
  icon?: ReactNode;
}

interface TabNavProps {
  tabs: Tab[];
  active: string;
  onChange: (key: string) => void;
  color?: string;
}

export function TabNav({ tabs, active, onChange, color = 'var(--color-primary)' }: TabNavProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-1)',
        marginBottom: 'var(--space-6)',
        borderBottom: '1px solid var(--color-border)',
        overflowX: 'auto',
      }}
    >
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 'var(--text-md)',
            fontWeight: active === tab.key ? 'var(--font-semibold)' : 'var(--font-medium)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            color: active === tab.key ? color : 'var(--color-text-tertiary)',
            borderBottom: active === tab.key ? `2px solid ${color}` : '2px solid transparent',
            transition: 'var(--transition-fast)',
            marginBottom: '-1px',
            whiteSpace: 'nowrap',
          }}
        >
          {tab.icon} {tab.label}
        </button>
      ))}
    </div>
  );
}

// ════════════════════════════════════════
//  SKELETON — LicitaSaaS Design System
// ════════════════════════════════════════

interface SkeletonProps {
  variant?: 'text' | 'text-lg' | 'card' | 'circle';
  width?: string | number;
  count?: number;
}

export function Skeleton({ variant = 'text', width, count = 1 }: SkeletonProps) {
  const cls = variant === 'text' ? 'skeleton skeleton-text'
    : variant === 'text-lg' ? 'skeleton skeleton-text-lg'
    : variant === 'card' ? 'skeleton skeleton-card'
    : 'skeleton skeleton-circle';

  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cls} style={width ? { width } : undefined} />
      ))}
    </>
  );
}

// ════════════════════════════════════════
//  COUNTDOWN BADGE — LicitaSaaS Design System
// ════════════════════════════════════════

interface CountdownBadgeProps {
  targetDate: Date | string;
  compact?: boolean;
}

export function CountdownBadge({ targetDate, compact = false }: CountdownBadgeProps) {
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

// ════════════════════════════════════════
//  STATUS DOT (live indicator)
// ════════════════════════════════════════

interface StatusDotProps {
  status: 'online' | 'offline' | 'monitoring';
  label?: string;
}

export function StatusDot({ status, label }: StatusDotProps) {
  const color = status === 'online' ? 'var(--color-success)' : status === 'monitoring' ? 'var(--color-primary)' : 'var(--color-text-tertiary)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
      <span
        className={status === 'monitoring' || status === 'online' ? 'badge-live' : undefined}
        style={{
          display: 'inline-block',
          width: 8, height: 8,
          borderRadius: '50%',
          background: color,
        }}
      />
      {label}
    </span>
  );
}
