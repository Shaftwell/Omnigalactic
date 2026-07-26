import * as React from 'react';
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      let errorDetails = null;
      try {
        if (this.state.error?.message) {
          errorDetails = JSON.parse(this.state.error.message);
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-dvh bg-slate-950 flex items-center justify-center p-6 font-sans">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl text-center">
            <div className="w-20 h-20 bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-red-500/20">
              <AlertTriangle className="w-10 h-10 text-red-500" />
            </div>
            
            <h1 className="text-2xl font-black text-white tracking-tighter mb-2 uppercase">System Malfunction</h1>
            <p className="text-slate-400 text-sm mb-8 leading-relaxed">
              An unexpected error occurred in the galactic hub. Our droids are working on it.
            </p>

            {errorDetails && (
              <div className="bg-slate-950 rounded-2xl p-4 mb-8 text-left border border-slate-800 overflow-hidden">
                <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">Error Diagnostics</p>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-[10px] text-slate-500 uppercase font-bold">Operation</span>
                    <span className="text-[10px] text-slate-300 font-mono">{errorDetails.operationType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[10px] text-slate-500 uppercase font-bold">Path</span>
                    <span className="text-[10px] text-slate-300 font-mono">{errorDetails.path}</span>
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-900">
                    <p className="text-[9px] text-red-400/70 font-mono break-all line-clamp-3">
                      {errorDetails.error}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={this.handleReset}
                className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-2xl transition-all active:scale-95 shadow-lg shadow-indigo-900/20"
              >
                <RefreshCcw className="w-4 h-4" />
                Retry
              </button>
              <button
                onClick={() => window.location.href = '/'}
                className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-3 px-4 rounded-2xl transition-all active:scale-95 border border-slate-700"
              >
                <Home className="w-4 h-4" />
                Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
