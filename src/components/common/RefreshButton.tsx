import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';

// R-03: botón pequeño para volver a pedir los datos de la pantalla sin recargar la web entera
// (no borra lo escrito ni cierra lo abierto). Gira mientras carga y no admite doble toque.
const RefreshButton: React.FC<{ onRefresh: () => unknown; className?: string; label?: string }> = ({
  onRefresh,
  className = '',
  label = 'Actualizar',
}) => {
  const [busy, setBusy] = useState(false);
  const click = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => { void click(); }}
      disabled={busy}
      aria-label={label}
      title={label}
      aria-busy={busy}
      className={`inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${className}`}
    >
      <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
};

export default RefreshButton;
