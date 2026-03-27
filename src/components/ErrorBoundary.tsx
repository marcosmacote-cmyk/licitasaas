import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ error, errorInfo });

    // Auto-reload on stale chunk errors (happens after new deploy)
    const msg = error?.message || '';
    if (
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Importing a module script failed') ||
      msg.includes('error loading dynamically imported module')
    ) {
      const reloadKey = 'error_boundary_reload';
      const lastReload = sessionStorage.getItem(reloadKey);
      const now = Date.now();
      // Only auto-reload once per 30 seconds to avoid infinite loops
      if (!lastReload || now - Number(lastReload) > 30000) {
        sessionStorage.setItem(reloadKey, String(now));
        window.location.reload();
        return;
      }
    }
  }

  public render() {
    if (this.state.hasError) {
      const isChunkError = this.state.error?.message?.includes('dynamically imported module') ||
        this.state.error?.message?.includes('module script failed');

      return (
        <div style={{ padding: "var(--space-6)", maxWidth: '600px', margin: 'var(--space-8) auto', textAlign: 'center' }}>
          <div style={{ padding: "var(--space-6)", background: "var(--color-bg-surface)", borderRadius: "var(--radius-xl)", border: "1px solid var(--color-border)", boxShadow: 'var(--shadow-md)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 'var(--space-3)' }}>{isChunkError ? '🔄' : '⚠️'}</div>
            <h2 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {isChunkError ? 'Nova versão disponível' : 'Algo deu errado'}
            </h2>
            <p style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-md)', color: 'var(--color-text-secondary)' }}>
              {isChunkError
                ? 'Uma atualização foi publicada. Recarregue a página para continuar.'
                : 'Um erro inesperado ocorreu. Tente recarregar a página.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: 'var(--space-3) var(--space-6)',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: 'var(--color-primary)',
                color: 'white',
                fontSize: 'var(--text-md)',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'var(--transition-fast)',
              }}
            >
              Recarregar Página
            </button>
            {!isChunkError && (
              <details style={{ marginTop: 'var(--space-4)', textAlign: 'left', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                <summary style={{ cursor: 'pointer' }}>Detalhes técnicos</summary>
                <pre style={{ whiteSpace: "pre-wrap", marginTop: 'var(--space-2)', padding: 'var(--space-3)', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-sm)', overflow: 'auto' }}>
                  {this.state.error?.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
