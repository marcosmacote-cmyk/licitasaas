import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';

// ════════════════════════════════════════
//  TABLE — LicitaSaaS Design System
// ════════════════════════════════════════

interface TableProps {
  children: ReactNode;
  className?: string;
}

export function Table({ children, className = '' }: TableProps) {
  return (
    <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
      <table
        className={className}
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 'var(--text-md)',
        }}
      >
        {children}
      </table>
    </div>
  );
}

// ════════════════════════════════════════
//  TABLE HEAD
// ════════════════════════════════════════

export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead style={{
      background: 'var(--color-bg-surface)',
      borderBottom: '2px solid var(--color-border)',
    }}>
      {children}
    </thead>
  );
}

// ════════════════════════════════════════
//  TABLE TH
// ════════════════════════════════════════

interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  children: ReactNode;
}

export function Th({ children, style, ...props }: ThProps) {
  return (
    <th
      style={{
        padding: 'var(--space-3) var(--space-6)',
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--font-semibold)',
        color: 'var(--color-text-secondary)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        textAlign: 'left',
        ...style,
      }}
      {...props}
    >
      {children}
    </th>
  );
}

// ════════════════════════════════════════
//  TABLE BODY
// ════════════════════════════════════════

export function Tbody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

// ════════════════════════════════════════
//  TABLE ROW
// ════════════════════════════════════════

interface TrProps {
  children: ReactNode;
  hoverable?: boolean;
  onClick?: () => void;
}

export function Tr({ children, hoverable = true, onClick }: TrProps) {
  return (
    <tr
      className={hoverable ? 'table-row-hover' : ''}
      onClick={onClick}
      style={{
        borderBottom: '1px solid var(--color-border)',
        ...(onClick ? { cursor: 'pointer' } : {}),
      }}
    >
      {children}
    </tr>
  );
}

// ════════════════════════════════════════
//  TABLE TD
// ════════════════════════════════════════

interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  children: ReactNode;
}

export function Td({ children, style, ...props }: TdProps) {
  return (
    <td
      style={{
        padding: 'var(--space-4) var(--space-6)',
        fontSize: 'var(--text-md)',
        color: 'var(--color-text-primary)',
        verticalAlign: 'middle',
        ...style,
      }}
      {...props}
    >
      {children}
    </td>
  );
}
