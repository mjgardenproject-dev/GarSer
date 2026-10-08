import React from 'react';
import { RefreshCw } from 'lucide-react';
import type { ServiceNameStatus } from '../../hooks/useServiceName';

/**
 * Lo que enseña «Detalles» mientras aún no sabe de qué servicio es la pantalla (solo pasa si el
 * nombre no venía de «Servicios», p. ej. al recargar aquí). Un esqueleto neutro con la forma del
 * selector, nunca la pantalla de otro servicio; y si la carga falla, un aviso con «Reintentar».
 */
export const DetailsServicePending: React.FC<{ status: Exclude<ServiceNameStatus, 'ready'>; onRetry: () => void }> = ({
  status,
  onRetry,
}) => {
  if (status === 'error') {
    return (
      <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">No hemos podido cargar el servicio.</p>
        <p className="mt-1 text-sm text-amber-800">Comprueba tu conexión e inténtalo de nuevo.</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 [touch-action:manipulation]"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div aria-busy="true" className="mb-5">
      <span className="sr-only" role="status">
        Cargando el servicio…
      </span>
      <div aria-hidden className="animate-pulse motion-reduce:animate-none">
        <div className="mb-3 h-4 w-48 rounded bg-gray-200" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-24 rounded-xl bg-gray-200" />
          <div className="h-24 rounded-xl bg-gray-200" />
        </div>
      </div>
    </div>
  );
};
