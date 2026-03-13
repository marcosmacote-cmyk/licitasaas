import { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

// ════════════════════════════════════════
//  CONFIRM DIALOG — LicitaSaaS Design System
// ════════════════════════════════════════

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      confirmRef.current?.focus();
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onCancel();
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }
  }, [open, onCancel]);

  if (!open) return null;

  const btnClass = variant === 'danger' ? 'btn-danger' : variant === 'warning' ? 'btn-primary' : 'btn-primary';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn 150ms ease-out',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-xl)',
          padding: 'var(--space-8)',
          maxWidth: 420,
          width: '90%',
          boxShadow: 'var(--shadow-xl)',
          animation: 'fadeInScale 200ms ease-out',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
          <div style={{
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-lg)',
            background: variant === 'danger' ? 'var(--color-danger-bg)' : variant === 'warning' ? 'var(--color-warning-bg)' : 'var(--color-primary-light)',
            color: variant === 'danger' ? 'var(--color-danger)' : variant === 'warning' ? 'var(--color-warning)' : 'var(--color-primary)',
            display: 'flex', flexShrink: 0,
          }}>
            <AlertTriangle size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 'var(--font-semibold)',
              color: 'var(--color-text-primary)',
              marginBottom: 'var(--space-2)',
            }}>
              {title}
            </h3>
            <p style={{
              fontSize: 'var(--text-md)',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.6,
            }}>
              {message}
            </p>
          </div>
          <button
            onClick={onCancel}
            style={{
              padding: 'var(--space-1)', cursor: 'pointer',
              color: 'var(--color-text-tertiary)', background: 'none', border: 'none', display: 'flex',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={`btn ${btnClass}`} onClick={onConfirm} ref={confirmRef}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
