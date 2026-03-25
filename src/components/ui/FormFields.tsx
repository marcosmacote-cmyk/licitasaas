import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';

// ════════════════════════════════════════
//  FORM FIELD WRAPPER — LicitaSaaS Design System
// ════════════════════════════════════════

interface FormFieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}

export function FormField({ label, hint, error, required, fullWidth, children }: FormFieldProps) {
  return (
    <div style={fullWidth ? { gridColumn: '1 / -1' } : undefined}>
      {label && (
        <label style={{
          display: 'block',
          fontSize: 'var(--text-md)',
          fontWeight: 'var(--font-semibold)',
          color: 'var(--color-text-secondary)',
          marginBottom: 'var(--space-3)',
        }}>
          {label}{required && ' *'}
        </label>
      )}
      {children}
      {hint && !error && (
        <p style={{
          fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)',
          marginTop: 'var(--space-1)', marginBottom: 0,
        }}>
          {hint}
        </p>
      )}
      {error && (
        <p style={{
          fontSize: 'var(--text-xs)', color: 'var(--color-danger)',
          marginTop: 'var(--space-1)', marginBottom: 0,
        }}>
          {error}
        </p>
      )}
    </div>
  );
}

// ════════════════════════════════════════
//  INPUT — LicitaSaaS Design System
// ════════════════════════════════════════

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  icon?: ReactNode;
  iconRight?: ReactNode;
  inputSize?: 'sm' | 'md';
}

export function Input({ icon, iconRight, inputSize = 'md', style, ...props }: InputProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      padding: inputSize === 'sm' ? 'var(--space-2) var(--space-3)' : 'var(--space-3) var(--space-4)',
      backgroundColor: 'var(--color-bg-base)',
      border: 'none',
      boxShadow: '0 0 0 1px var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      transition: 'all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    }}>
      {icon}
      <input
        style={{
          border: 'none',
          background: 'transparent',
          outline: 'none',
          width: '100%',
          color: 'var(--color-text-primary)',
          fontSize: 'var(--text-base)',
          ...style,
        }}
        {...props}
      />
      {iconRight}
    </div>
  );
}

// ════════════════════════════════════════
//  TEXTAREA — LicitaSaaS Design System
// ════════════════════════════════════════

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  icon?: ReactNode;
  minHeight?: string;
}

export function Textarea({ icon, minHeight = '80px', style, ...props }: TextareaProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-4)',
      backgroundColor: 'var(--color-bg-base)',
      border: 'none',
      boxShadow: '0 0 0 1px var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      transition: 'all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    }}>
      {icon && <div style={{ marginTop: '4px' }}>{icon}</div>}
      <textarea
        style={{
          border: 'none',
          background: 'transparent',
          outline: 'none',
          width: '100%',
          color: 'var(--color-text-primary)',
          fontSize: 'var(--text-base)',
          minHeight,
          resize: 'vertical',
          fontFamily: 'inherit',
          ...style,
        }}
        {...props}
      />
    </div>
  );
}

// ════════════════════════════════════════
//  SELECT — LicitaSaaS Design System
// ════════════════════════════════════════

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  icon?: ReactNode;
  options: SelectOption[];
  placeholder?: string;
}

export function Select({ icon, options, placeholder, style, ...props }: SelectProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-4)',
      backgroundColor: 'var(--color-bg-base)',
      border: 'none',
      boxShadow: '0 0 0 1px var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      transition: 'all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    }}>
      {icon}
      <select
        style={{
          border: 'none',
          background: 'transparent',
          outline: 'none',
          width: '100%',
          color: 'var(--color-text-primary)',
          fontSize: 'var(--text-base)',
          cursor: 'pointer',
          ...style,
        }}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(opt => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
