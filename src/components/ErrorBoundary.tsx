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
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "var(--space-5)", background: "var(--color-danger-bg)", color: "var(--color-danger-hover)", margin: "var(--space-5)", borderRadius: "var(--radius-md)", border: "1px solid var(--color-danger-border)" }}>
          <h2>Algo deu muito errado no React (Tela Branca)</h2>
          <p><strong>Error:</strong> {this.state.error?.toString()}</p>
          <details style={{ whiteSpace: "pre-wrap", marginTop: "var(--space-3)", padding: "var(--space-3)", background: "var(--color-danger-bg)", fontSize: "12px" }}>
            {this.state.errorInfo?.componentStack}
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
