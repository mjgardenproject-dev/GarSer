import { useState } from 'react';
import { Calendar, Clock, MapPin, MessageCircle, Star, RotateCcw, ChevronDown, ImageIcon } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

import { ClientBookingAmounts } from './BookingAmounts';
import { formatEuro } from '../../shared/bookingAmounts';
import { getBookingStatusLabel, getBookingStatusTone, isCancellableStatus } from '../../shared/bookingStatus';

/**
 * Tarjeta de reserva del cliente. Única para "Mis reservas" y para el inicio.
 *
 * Antes había dos implementaciones distintas de lo mismo: la página tenía importes, cambio de
 * precio, fotos y cancelar; el inicio tenía repetir servicio, la nota de la reseña y un diseño
 * móvil mejor. Ninguna de las dos estaba completa y el cliente veía cosas distintas según por
 * dónde entrara.
 *
 * `compact` no cambia el aspecto, solo la PROFUNDIDAD: en el inicio los importes y las fotos
 * viven tras "Ver detalles" para que la pantalla siga siendo una lista escaneable; en la página
 * completa se muestran desplegados. Misma tarjeta, mismo lenguaje visual.
 */

export interface ClientBookingCardBooking {
  id: string;
  status: string;
  date: string;
  start_time?: string | null;
  duration_hours?: number | null;
  client_address?: string | null;
  gardener_id?: string | null;
  notes?: string | null;
  media_urls?: string[];
  /** Nota que dejó el cliente, si ya valoró. */
  review_rating?: number | null;
  // Nombre del servicio y del profesional: cada superficie los trae con una forma distinta.
  services?: { name?: string | null; icon?: string | null } | null;
  service_name?: string | null;
  gardener_profile?: { full_name?: string | null } | null;
  gardener_name?: string | null;
  // Importes
  total_price?: number | null;
  management_fee?: number | null;
  management_fee_source?: string | null;
  client_total_price?: number | null;
  // Cambio de precio
  price_change_status?: string | null;
  proposed_total_price?: number | null;
  proposed_price_reason?: string | null;
}

interface Props {
  booking: ClientBookingCardBooking;
  /** En el inicio: importes y fotos plegados. En la página completa: desplegados. */
  compact?: boolean;
  /** Rótulo opcional sobre el título ("Próxima reserva", "Pendiente de aceptar"…). */
  eyebrow?: string;
  /** Acento del borde, para que el inicio siga distinguiendo sus grupos. */
  accent?: 'default' | 'upcoming' | 'attention';
  busy?: boolean;
  onOpenChat?: (booking: ClientBookingCardBooking) => void;
  onCancel?: (booking: ClientBookingCardBooking) => void;
  onReview?: (booking: ClientBookingCardBooking) => void;
  onRebook?: (booking: ClientBookingCardBooking) => void;
  onAcceptPriceChange?: (booking: ClientBookingCardBooking) => void;
  onRejectPriceChange?: (booking: ClientBookingCardBooking) => void;
}

const ACCENTS: Record<NonNullable<Props['accent']>, string> = {
  default: 'border-gray-200',
  upcoming: 'border-green-200 ring-1 ring-green-100',
  attention: 'border-amber-200 bg-amber-50/40',
};

/** `10:00:00` → `10:00`. La página completa mostraba los segundos. */
const formatTime = (value?: string | null) => (value ? value.slice(0, 5) : null);

const Stars = ({ value }: { value: number }) => (
  <span className="inline-flex items-center gap-0.5" aria-label={`Tu valoración: ${value} de 5`}>
    {[0, 1, 2, 3, 4].map((index) => {
      const filled = Math.max(Math.min(value - index, 1), 0);
      return (
        <span key={index} className="relative w-3.5 h-3.5">
          <Star className="w-3.5 h-3.5 absolute inset-0 text-gray-300" aria-hidden="true" />
          <span className="absolute inset-0 overflow-hidden" style={{ width: `${filled * 100}%` }}>
            <Star className="w-3.5 h-3.5 text-yellow-400 fill-current" aria-hidden="true" />
          </span>
        </span>
      );
    })}
  </span>
);

/** Limpia el bloque legacy `Fotos:\n<url>` que algunas notas antiguas llevan incrustado. */
const cleanNotes = (notes?: string | null) => {
  const text = String(notes || '').split(/Fotos:\s*\n?/i)[0].trim();
  return text || null;
};

const ClientBookingCard = ({
  booking,
  compact = false,
  eyebrow,
  accent = 'default',
  busy = false,
  onOpenChat,
  onCancel,
  onReview,
  onRebook,
  onAcceptPriceChange,
  onRejectPriceChange,
}: Props) => {
  const [showDetails, setShowDetails] = useState(!compact);

  const serviceName = booking.services?.name || booking.service_name || 'Servicio';
  const gardenerName = booking.gardener_profile?.full_name || booking.gardener_name || 'Tu profesional';
  const gardenerFirstName = gardenerName.split(' ')[0];
  const notes = cleanNotes(booking.notes);
  const photos = booking.media_urls || [];
  const hasPriceChange = booking.price_change_status === 'pending_client_acceptance';
  const canCancel = isCancellableStatus(booking.status) && Boolean(onCancel);
  const isCompleted = booking.status === 'completed';

  return (
    <article className={`bg-white border rounded-xl p-4 shadow-sm ${ACCENTS[accent]}`}>
      {/* Cabecera: una sola idea dominante — qué servicio y con quién. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && (
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-green-700 mb-0.5">
              {eyebrow}
            </span>
          )}
          <h3 className="font-semibold text-gray-900 truncate">{serviceName}</h3>
          <p className="text-sm text-gray-600 truncate">con {gardenerName}</p>
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${getBookingStatusTone(booking.status)}`}>
          {getBookingStatusLabel(booking.status, 'client')}
        </span>
      </div>

      {/* Datos del servicio en vertical: en 390 px una rejilla horizontal parte las direcciones. */}
      <dl className="mt-3 space-y-1.5 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />
          <dd className="first-letter:uppercase">{format(parseISO(booking.date), "EEEE, d 'de' MMMM 'de' yyyy", { locale: es })}</dd>
        </div>
        {formatTime(booking.start_time) && (
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />
            <dd>
              {formatTime(booking.start_time)}
              {booking.duration_hours ? ` · ${booking.duration_hours} h` : ''}
            </dd>
          </div>
        )}
        {booking.client_address && (
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" aria-hidden="true" />
            <dd className="break-words">{booking.client_address}</dd>
          </div>
        )}
      </dl>

      {/* El cambio de precio NUNCA se pliega: mueve dinero y espera respuesta. */}
      {hasPriceChange && (
        <div className="mt-3 p-3 rounded-lg border border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">
            {gardenerFirstName} propone un nuevo precio del servicio:{' '}
            <strong>{formatEuro(booking.proposed_total_price)}</strong>
          </p>
          {booking.proposed_price_reason && (
            <p className="mt-1 text-sm text-amber-800">
              <span className="font-medium">Motivo:</span> {booking.proposed_price_reason}
            </p>
          )}
          <p className="mt-1 text-xs text-amber-800">
            Los gastos de gestión que ya abonaste no cambian.
          </p>
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => onAcceptPriceChange?.(booking)}
              disabled={busy}
              className="flex-1 bg-green-600 px-4 py-2.5 rounded-xl text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 transition-colors"
            >
              Aceptar nuevo precio
            </button>
            <button
              type="button"
              onClick={() => onRejectPriceChange?.(booking)}
              disabled={busy}
              className="flex-1 bg-white px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 transition-colors"
            >
              Rechazar
            </button>
          </div>
        </div>
      )}

      {/* Nota de la valoración propia: cierra el ciclo sin ocupar sitio. */}
      {isCompleted && booking.review_rating != null && (
        <div className="mt-3 flex items-center gap-2 text-sm text-gray-600">
          <Stars value={Number(booking.review_rating)} />
          <span>Tu valoración</span>
        </div>
      )}

      {compact && (
        <button
          type="button"
          onClick={() => setShowDetails((value) => !value)}
          aria-expanded={showDetails}
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded"
        >
          {showDetails ? 'Ocultar detalles' : 'Ver detalles'}
          <ChevronDown className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      )}

      {showDetails && (
        <div className="mt-3 space-y-3">
          <ClientBookingAmounts booking={booking as never} />

          {notes && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Tus indicaciones</p>
              <p className="text-sm text-gray-700 whitespace-pre-line break-words">{notes}</p>
            </div>
          )}

          {photos.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1.5 inline-flex items-center gap-1">
                <ImageIcon className="w-3.5 h-3.5" aria-hidden="true" />
                Fotos del servicio
              </p>
              <div className="grid grid-cols-4 gap-1.5">
                {photos.slice(0, 8).map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="block aspect-square rounded-lg overflow-hidden border border-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Acciones: la principal a ancho completo y al alcance del pulgar. */}
      <div className="mt-4 space-y-2">
        {onOpenChat && (booking.status === 'pending' || booking.status === 'confirmed') && (
          <button
            type="button"
            onClick={() => onOpenChat(booking)}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 transition-colors"
          >
            <MessageCircle className="w-4 h-4" aria-hidden="true" />
            Hablar con {gardenerFirstName}
          </button>
        )}

        {isCompleted && onReview && booking.review_rating == null && (
          <button
            type="button"
            onClick={() => onReview(booking)}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 transition-colors"
          >
            <Star className="w-4 h-4" aria-hidden="true" />
            Dejar mi valoración
          </button>
        )}

        {/* Repetir: disponible en CUALQUIER servicio completado, se haya valorado o no. */}
        {isCompleted && onRebook && (
          <button
            type="button"
            onClick={() => onRebook(booking)}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 transition-colors"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            {busy ? 'Preparando…' : 'Volver a reservar'}
          </button>
        )}

        {canCancel && (
          <button
            type="button"
            onClick={() => onCancel?.(booking)}
            disabled={busy}
            className="w-full rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 transition-colors"
          >
            {busy ? 'Cancelando…' : 'Cancelar reserva'}
          </button>
        )}
      </div>
    </article>
  );
};

export default ClientBookingCard;
