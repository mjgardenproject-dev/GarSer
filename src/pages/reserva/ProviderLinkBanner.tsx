import React from 'react';
import { UserRound } from 'lucide-react';

/**
 * Recordatorio de que la reserva es con el profesional del enlace. Sin él, el cliente que
 * retomaba una reserva empezada desde un enlace no sabía por qué solo veía a un profesional.
 */
const ProviderLinkBanner: React.FC<{ providerName: string }> = ({ providerName }) => (
  <div className="mb-3 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
    <UserRound aria-hidden="true" className="h-4 w-4 shrink-0 text-green-700" />
    <p className="min-w-0">
      Reserva con <span className="font-semibold">{providerName}</span>
    </p>
  </div>
);

export default ProviderLinkBanner;
