import type { ButtonHTMLAttributes, ReactNode } from 'react';

// ════════════════════════════════════════
//  BUTTON — LicitaSaaS Design System
// ════════════════════════════════════════

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'ai';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'btn-sm',
  md: '',
  lg: '',
};

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: {},
  md: {},
  lg: { padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--text-base)' },
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  fullWidth = false,
  children,
  className = '',
  style,
  disabled,
  ...props
}: ButtonProps) {
  const classes = [
    'btn',
    `btn-${variant}`,
    sizeClasses[size],
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      className={classes}
      disabled={disabled || loading}
      style={{
        ...sizeStyles[size],
        ...(fullWidth ? { width: '100%' } : {}),
        ...(disabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
        ...style,
      }}
      {...props}
    >
      {loading ? (
        <span className="spinner" style={{ display: 'inline-flex' }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-6.2-8.6" />
          </svg>
        </span>
      ) : icon}
      {children}
      {iconRight}
    </button>
  );
}

// ════════════════════════════════════════
//  ICON BUTTON
// ════════════════════════════════════════

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  size?: 'sm' | 'md';
}

export function IconButton({ icon, label, size = 'md', className = '', style, ...props }: IconButtonProps) {
  return (
    <button
      className={`icon-btn ${className}`}
      title={label}
      aria-label={label}
      style={{
        ...(size === 'sm' ? { padding: 'var(--space-1)' } : {}),
        ...style,
      }}
      {...props}
    >
      {icon}
    </button>
  );
}
