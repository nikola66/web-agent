import { Component, type ErrorInfo, type ReactNode } from "react";
import { isChunkLoadError, reloadAppForStaleChunks } from "../lazy-with-retry";

interface Props {
  children: ReactNode;
  label?: string;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  private reload = () => {
    if (this.state.error && isChunkLoadError(this.state.error)) {
      reloadAppForStaleChunks();
      return;
    }
    this.reset();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    const staleChunk = isChunkLoadError(this.state.error);
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center text-text-muted">
        <div className="text-sm">
          {this.props.label ? `${this.props.label} crashed.` : "Something went wrong."}
        </div>
        <div className="font-mono text-[11px] opacity-70">{this.state.error.message}</div>
        {staleChunk ? (
          <p className="max-w-xs text-[11px] opacity-80">
            The app was updated while this tab was open. Reload to fetch the latest code.
          </p>
        ) : null}
        <button
          type="button"
          onClick={this.reload}
          className="rounded-sm border border-white/10 bg-black/30 px-3 py-1 text-xs text-text-primary hover:bg-black/50"
        >
          {staleChunk ? "Reload app" : "Reload panel"}
        </button>
      </div>
    );
  }
}
