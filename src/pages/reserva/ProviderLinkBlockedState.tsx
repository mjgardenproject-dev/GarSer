import React from 'react';
import { CalendarSearch, MapPinOff, RefreshCw, SearchX, Users, type LucideIcon } from 'lucide-react';
import type { ProviderLinkBlockCopy, ProviderLinkBlockReason } from '../../utils/providerLink';

/**
 * «Profesionales» cuando la reserva viene del enlace de un profesional y ese profesional no
 * sale. Antes se veía el genérico «No hay profesionales disponibles», sin decir que solo se
 * estaba mirando a uno ni por qué no podía. Ahora: el motivo, la acción para seguir con él y,
 * solo si no puede hacer el trabajo nunca, la opción de ver a otros profesionales.
 */
const ICONS: Partial<Record<ProviderLinkBlockReason, LucideIcon>> = {
  outside_coverage: MapPinOff,
  address_unlocated: MapPinOff,
  no_availability: CalendarSearch,
};

interface Props {
  reason: ProviderLinkBlockReason;
  copy: ProviderLinkBlockCopy;
  onPrimary: () => void;
  onShowOtherProviders: () => void;
}

const ProviderLinkBlockedState: React.FC<Props> = ({ reason, copy, onPrimary, onShowOtherProviders }) => {
  const Icon = ICONS[reason] || SearchX;
  return (
    <section
      aria-labelledby="provider-link-blocked-title"
      aria-live="polite"
      className="mx-auto mt-6 max-w-sm rounded-2xl border border-gray-200 bg-white p-6 text-center"
    >
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50">
        <Icon aria-hidden className="h-7 w-7 text-amber-600" />
      </div>
      <h3 id="provider-link-blocked-title" className="text-lg font-bold text-gray-900 text-balance">
        {copy.title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-gray-600 text-pretty">{copy.detail}</p>

      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={onPrimary}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]"
        >
          {copy.primaryAction === 'retry' && <RefreshCw aria-hidden="true" className="h-4 w-4" />}
          {copy.primaryLabel}
        </button>
        {copy.offerOtherProviders && (
          <button
            type="button"
            onClick={onShowOtherProviders}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]"
          >
            <Users aria-hidden="true" className="h-4 w-4" />
            Ver otros profesionales
          </button>
        )}
      </div>
    </section>
  );
};

export default ProviderLinkBlockedState;
