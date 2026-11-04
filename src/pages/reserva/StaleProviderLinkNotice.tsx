import React from 'react';
import { Info } from 'lucide-react';

/**
 * Aviso para quien reserva por un enlace de profesional cuya clave ya no vale (el profesional lo
 * cambió, o el enlace está incompleto): el enlace sigue abriendo su perfil, pero esa reserva no
 * cuenta como «cliente del profesional». Solo se enseña si el cliente SÍ traía una clave (si no
 * traía ninguna, no se le ha prometido nada) y si de verdad hay gastos de gestión que pagar.
 */
const StaleProviderLinkNotice: React.FC<{ providerName?: string | null }> = ({ providerName }) => (
  <div role="status" className="mb-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
    <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
    <p>
      Este enlace ya no es el directo de {providerName?.trim() || 'tu profesional'}, así que no incluye la reserva sin
      gastos de gestión. Pídele su enlace actualizado si quieres reservar sin ellos.
    </p>
  </div>
);

export default StaleProviderLinkNotice;
