import type { HTMLAttributes, ReactNode } from 'react';

// ════════════════════════════════════════
//  CARD — LicitaSaaS Design System
// ════════════════════════════════════════

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  children: ReactNode;
}

const paddings: Record<string, string> = {
  none: '0',
  sm: 'var(--space-4)',
  md: 'var(--card-padding)',
  lg: 'var(--space-8)',
};

export function Card({ interactive = false, padding = 'md', children, className = '', style, ...props }: CardProps) {
  const classes = ['card', interactive ? 'card-interactive' : '', className].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      style={{
        padding: paddings[padding],
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

// ════════════════════════════════════════
//  CARD HEADER — compound component
// ════════════════════════════════════════

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function CardHeader({ title, subtitle, icon, action }: CardHeaderProps) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: 'var(--space-4)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {icon && (
          <div style={{
            padding: 'var(--space-2)', borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg-surface-hover)', display: 'flex',
          }}>
            {icon}
          </div>
        )}
        <div>
          <h3 style={{
            fontSize: 'var(--text-md)', fontWeight: 'var(--font-semibold)',
            color: 'var(--color-text-primary)', margin: 0,
          }}>
            {title}
          </h3>
          {subtitle && (
            <p style={{
              fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', margin: 0,
              marginTop: '1px',
            }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}
