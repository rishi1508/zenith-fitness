import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i;

/**
 * Last line of defence: a render error anywhere below would otherwise unmount
 * the whole tree and leave a blank screen with no way back. Shows a themed
 * recovery card instead. A failed lazy-chunk download (offline on first visit,
 * or a deploy that replaced hashed files) is recognised and offered a reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private reload = () => { window.location.reload(); };

  private reset = () => { this.setState({ error: null }); };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const isChunk = CHUNK_ERROR.test(error.message);
    return (
      <div className="min-h-dvh flex items-center justify-center bg-bg px-6" role="alert">
        <div className="w-full max-w-sm rounded-card border border-border bg-surface p-5 space-y-3">
          <h1 className="font-display text-lg font-bold text-text">
            {isChunk ? 'Update needed' : 'Something went wrong'}
          </h1>
          <p className="text-[13px] leading-[18px] text-muted">
            {isChunk
              ? 'A part of the app could not be loaded — usually a new version was just published or the connection dropped. Reload to pick it up.'
              : 'The screen hit an unexpected error. Your data is safe on this device and in the cloud. Reload to continue.'}
          </p>
          {!isChunk && (
            <pre className="text-[11px] leading-4 text-subtle whitespace-pre-wrap break-words max-h-24 overflow-auto">{error.message}</pre>
          )}
          <div className="flex gap-2 pt-1">
            {!isChunk && (
              <button onClick={this.reset} className="flex-1 h-11 rounded-[12px] border border-border bg-surface-2 text-sm font-semibold text-text">
                Try again
              </button>
            )}
            <button onClick={this.reload} className="flex-1 h-11 rounded-[12px] bg-accent text-sm font-semibold text-white">
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
