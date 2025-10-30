import React from 'react';

type ErrorBoundaryProps = {
  children: React.ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error?: Error;
};

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Podemos reportar el error a un servicio de logging si hace falta.
    console.warn('ErrorBoundary capturó un error:', error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[40vh] flex items-center justify-center">
          <div className="max-w-md w-full bg-white border border-gray-200 rounded-xl p-6 text-center">
            <div className="text-lg font-semibold text-gray-800 mb-2">
              {this.props.fallbackTitle || 'Ha ocurrido un error inesperado'}
            </div>
            <div className="text-sm text-gray-600 mb-4">
              {this.props.fallbackMessage || 'Perdón por las molestias. Puedes intentar recargar o volver atrás.'}
            </div>
            <div className="flex items-center justify-center gap-3">
              <button
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm"
                onClick={this.handleRetry}
              >
                Reintentar
              </button>
              <button
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-sm"
                onClick={() => window.history.back()}
              >
                Volver atrás
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}