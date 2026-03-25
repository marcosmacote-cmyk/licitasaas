import { useEffect, useCallback, type ReactNode } from 'react';
import { X } from 'lucide-react';

// ════════════════════════════════════════
//  MODAL — LicitaSaaS Design System
// ════════════════════════════════════════

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
  maxWidth?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  maxWidth = '600px',
  children,
  footer,
}: ModalProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = '';
      };
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(8px)',
        animation: 'fadeIn 0.2s ease-out',
        padding: 'var(--space-5)',
      }}
      onClick={onClose}
    >
      <div
        className="modal-content"
        style={{
          maxWidth,
          width: '100%',
          maxHeight: '90vh',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-xl), 0 0 0 1px var(--color-border)',
          overflow: 'hidden',
          backgroundColor: 'var(--color-bg-surface)',
          border: 'none',
          animation: 'slideUp 0.3s ease-out',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        {title && (
          <div style={{
            padding: 'var(--space-6) var(--space-8)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'linear-gradient(to right, var(--color-bg-surface), var(--color-bg-surface-hover))',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
              {icon && (
                <div style={{
                  padding: 'var(--space-3)',
                  background: 'var(--color-primary-light)',
                  borderRadius: 'var(--radius-lg)',
                  color: 'var(--color-primary)',
                  display: 'flex',
                }}>
                  {icon}
                </div>
              )}
              <div>
                <h2 style={{
                  fontSize: 'var(--text-3xl)',
                  fontWeight: 'var(--font-bold)',
                  color: 'var(--color-text-primary)',
                  margin: 0,
                }}>
                  {title}
                </h2>
                {subtitle && (
                  <p style={{
                    color: 'var(--color-text-secondary)',
                    fontSize: 'var(--text-md)',
                    marginTop: '2px',
                  }}>
                    {subtitle}
                  </p>
                )}
              </div>
            </div>
            <button
              className="icon-btn"
              onClick={onClose}
              aria-label="Fechar"
              style={{
                background: 'var(--color-bg-surface)',
                borderRadius: 'var(--radius-full)',
                padding: 'var(--space-2)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <X size={20} />
            </button>
          </div>
        )}

        {/* Body */}
        <div style={{
          padding: 'var(--space-8)',
          overflowY: 'auto',
          flex: 1,
        }}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div style={{
            padding: 'var(--space-4) var(--space-8)',
            borderTop: 'none',
            boxShadow: '0 -1px 0 var(--color-border)',
            display: 'flex',
            gap: 'var(--space-3)',
            justifyContent: 'flex-end',
            background: 'var(--color-bg-surface)',
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
