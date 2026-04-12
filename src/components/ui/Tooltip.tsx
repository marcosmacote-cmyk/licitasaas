import React, { useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import { HelpCircle, Info, X } from 'lucide-react';

// ══════════════════════════════════════════════════════════════
//  SIMPLE TOOLTIP — Wrap any element to show a native CSS-based tooltip
// ══════════════════════════════════════════════════════════════

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

export function Tooltip({ content, children, position = 'top', delay = 200 }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      setIsRendered(true);
      // Small delay for animation
      requestAnimationFrame(() => setIsVisible(true));
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsVisible(false);
    setTimeout(() => setIsRendered(false), 150); // wait for fade out
  };



  return (
    <div
      className="tooltip-container"
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
    >
      {children}
      {isRendered && (
        <div
          style={{
            position: 'absolute',
            zIndex: 9999,
            backgroundColor: 'var(--color-bg-inverse)',
            color: 'var(--color-text-inverse)',
            padding: '6px 10px',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-xs)',
            fontWeight: 500,
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            opacity: isVisible ? 1 : 0,
            transition: 'opacity 0.15s ease, transform 0.15s ease',
            pointerEvents: 'none',
            ...getPositionStyles(position),
          }}
        >
          {content}
          <div style={getArrowStyles(position)} />
        </div>
      )}
    </div>
  );
}

// Helper generic tooltips
export function TooltipHelp({ text }: { text: string }) {
  return (
    <Tooltip content={text} position="top">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', cursor: 'help' }}>
        <HelpCircle size={14} />
      </div>
    </Tooltip>
  );
}

export function TooltipInfo({ text }: { text: string }) {
  return (
    <Tooltip content={text} position="top">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)', cursor: 'help' }}>
        <Info size={14} />
      </div>
    </Tooltip>
  );
}


// ══════════════════════════════════════════════════════════════
//  EDUCATIONAL POPOVER — Used for complex module explanations
// ══════════════════════════════════════════════════════════════
interface EducationalPopoverProps {
  id: string; // Unique ID to track if user already dismissed it
  title: string;
  content: ReactNode;
  children: ReactNode;
  forceShow?: boolean;
}

export function EducationalPopover({ id, title, content, children, forceShow = false }: EducationalPopoverProps) {
  const [isOpen, setIsOpen] = useState(forceShow);
  
  useEffect(() => {
    if (forceShow) return;
    const dismissed = localStorage.getItem(`edu_popover_${id}`);
    if (!dismissed) {
      // Small delay on mount so it feels alive
      const t = setTimeout(() => setIsOpen(true), 1500);
      return () => clearTimeout(t);
    }
  }, [id, forceShow]);

  const dismiss = () => {
    setIsOpen(false);
    localStorage.setItem(`edu_popover_${id}`, 'true');
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ cursor: 'pointer', display: 'inline-block' }}
      >
        {children}
      </div>

      {isOpen && (
        <div
          className="animate-slide-up"
          style={{
            position: 'absolute',
            top: 'calc(100% + 12px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 999,
            width: 320,
            backgroundColor: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            padding: 'var(--space-4)',
          }}
        >
          {/* Arrow pointing up */}
          <div style={{
            position: 'absolute', top: -7, left: '50%', transform: 'translateX(-50%) rotate(45deg)',
            width: 14, height: 14, backgroundColor: 'var(--color-bg-surface)',
            borderTop: '1px solid var(--color-border)', borderLeft: '1px solid var(--color-border)',
          }} />

          <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <div style={{ padding: 6, borderRadius: 'var(--radius-md)', background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
                <Info size={16} />
              </div>
              <h4 style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)' }}>{title}</h4>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); dismiss(); }}
              style={{ background: 'none', border: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: 4 }}
            >
              <X size={14} />
            </button>
          </div>
          
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
            {content}
          </div>
          
          <div style={{ marginTop: 'var(--space-4)', display: 'flex', justifyContent: 'flex-end' }}>
            <button 
              className="btn btn-primary" 
              style={{ padding: '6px 12px', fontSize: 'var(--text-xs)' }}
              onClick={(e) => { e.stopPropagation(); dismiss(); }}
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Native positioning math ──
function getPositionStyles(pos: string): React.CSSProperties {
  switch (pos) {
    case 'top': return { bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' };
    case 'bottom': return { top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' };
    case 'left': return { right: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)' };
    case 'right': return { left: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)' };
    default: return {};
  }
}

function getArrowStyles(pos: string): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    width: 0, height: 0,
    borderStyle: 'solid',
  };
  const color = 'var(--color-bg-inverse)';
  switch (pos) {
    case 'top': return { ...base, bottom: -4, left: '50%', transform: 'translateX(-50%)', borderWidth: '5px 5px 0 5px', borderColor: `${color} transparent transparent transparent` };
    case 'bottom': return { ...base, top: -4, left: '50%', transform: 'translateX(-50%)', borderWidth: '0 5px 5px 5px', borderColor: `transparent transparent ${color} transparent` };
    case 'left': return { ...base, right: -4, top: '50%', transform: 'translateY(-50%)', borderWidth: '5px 0 5px 5px', borderColor: `transparent transparent transparent ${color}` };
    case 'right': return { ...base, left: -4, top: '50%', transform: 'translateY(-50%)', borderWidth: '5px 5px 5px 0', borderColor: `transparent ${color} transparent transparent` };
    default: return {};
  }
}
