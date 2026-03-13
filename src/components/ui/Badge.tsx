import type { HTMLAttributes, ReactNode } from 'react';

// ════════════════════════════════════════
//  BADGE — LicitaSaaS Design System
// ════════════════════════════════════════

export type BadgeVariant =
  | 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  | 'ai' | 'urgency' | 'teal';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  icon?: ReactNode;
  dot?: boolean;
  pulse?: boolean;
  children: ReactNode;
}

export function Badge({
  variant = 'neutral',
  icon,
  dot = false,
  pulse = false,
  children,
  className = '',
  style,
  ...props
}: BadgeProps) {
  const classes = [
    'badge',
    `badge-${variant}`,
    pulse ? 'badge-live' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <span
      className={classes}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        ...style,
      }}
      {...props}
    >
      {dot && (
        <span
          style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'currentColor', flexShrink: 0,
          }}
        />
      )}
      {icon}
      {children}
    </span>
  );
}
