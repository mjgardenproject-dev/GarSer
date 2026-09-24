import { useState } from 'react';
import { Calendar, Clock, MapPin, MessageCircle, Star, RotateCcw, ChevronDown, ImageIcon, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

import { ClientBookingAmounts } from './BookingAmounts';
import { formatEuro } from '../../shared/bookingAmounts';
import WhoIsComing from './WhoIsComing';
import { formatDateRange, isMultiDay } from '../../utils/jobShape';
import {
  canReportIncident,
  getBookingStatusLabel,
  getBookingStatusTone,
  isCancellableStatus,
  needsClientConfirmation,
} from '../../shared/bookingStatus';
import { bookingServiceLabel } from '../../utils/bookingServiceLabel';

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
  gardener_profile?: { full_name?: string | null; is_company?: boolean } | null;
  gardener_name?: string | null;
  /** GarSer Empresas (F5.4): el proveedor es una empresa → se la nombra entera, no por su «nombre de pila». */
  gardener_is_company?: boolean;
  // Importes
  total_price?: number | null;
  management_fee?: number | null;
  management_fee_source?: string | null;
  client_total_price?: number | null;
  // Cambio de precio
  price_change_status?: string | null;
  proposed_total_price?: number | null;
  proposed_price_reason?: string | null;
  /** D5: cambio de duración adjunto a la propuesta de precio (solo mueve la hora de fin). */
  proposed_duration_hours?: number | null;
  /** Cuándo se da por completada sola si no se confirma nada. */
  confirmation_deadline_at?: string | null;
  /** GarSer Empresas (F6.3, D9): la empresa propone otra fecha. */
  reschedule_status?: string | null;
  proposed_date?: string | null;
  proposed_start_time?: string | null;
  reschedule_reason?: string | null;
  /** GarSer Empresas (F7): último día si dura varios, y horas de trabajo si es de equipo o de varios días. */
  end_date?: string | null;
  labour_hours?: number | null;
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
  onAcceptReschedule?: (booking: ClientBookingCardBooking) => void;
  onRejectReschedule?: (booking: ClientBookingCardBooking) => void;
  /** El cliente confirma que el trabajo se hizo. Cierra la reserva y desbloquea la valoración. */
  onConfirmService?: (booking: ClientBookingCardBooking) => void;
  /** Abre el parte de incidencia. El cliente no cierra nada por su cuenta: lo revisa un admin. */
  onReportIncident?: (booking: ClientBookingCardBooking) => void;
}

const ACCENTS: Record<NonNullable<Props['accent']>, string> = {
  default: 'border-gray-200',
  upcoming: 'border-green-200 ring-1 ring-green-100',
  attention: 'border-amber-200 bg-amber-50/40',
};

/** `10:00:00` → `10:00`. La página completa mostraba los segundos. */
const formatTime = (value?: string | null) => (value ? value.slice(0, 5) : null);

/** D5 — "10:00:00" + 3h => "13:00". Solo para previsualizar el nuevo fin propuesto. */
const addHoursToTime = (startTime?: string | null, hours?: number | null): string | null => {
  if (!startTime || !hours || hours <= 0) return null;
  const [h, m] = startTime.split(':').map(Number);
  if (!Number.isFinite(h)) return null;
  const totalMinutes = h * 60 + (Number.isFinite(m) ? m : 0) + hours * 60;
  const endHour = Math.floor(totalMinutes / 60) % 24;
  const endMinute = totalMinutes % 60;
  return `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
};

/** Fecha límite del correo de confirmación, en el mismo formato que promete el email. */
const formatDeadline = (iso?: string | null): string | null => {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const day = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(parsed);
  const time = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(parsed);
  return `${day} a las ${time}`;
};

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
  onAcceptReschedule,
  onRejectReschedule,
  onConfirmService,
  onReportIncident,
}: Props) => {
  const [showDetails, setShowDetails] = useState(!compact);

  // F8: la etiqueta de varios servicios viene ya hecha (service_name) o de booking_items.
  const serviceName = bookingServiceLabel(booking as never) || booking.service_name || 'Servicio';
  const multiDay = isMultiDay({ date: booking.date, endDate: booking.end_date });
  const gardenerName = booking.gardener_profile?.full_name || booking.gardener_name || 'Tu profesional';
  const isCompany = Boolean(booking.gardener_profile?.is_company || booking.gardener_is_company);
  const gardenerFirstName = isCompany ? gardenerName : gardenerName.split(' ')[0];
  const notes = cleanNotes(booking.notes);
  const photos = booking.media_urls || [];
  const hasPriceChange = booking.price_change_status === 'pending_client_acceptance';
  const canCancel = isCancellableStatus(booking.status) && Boolean(onCancel);
  const isCompleted = booking.status === 'completed';
  const isDisputed = booking.status === 'disputed';
  const awaitingConfirmation = needsClientConfirmation(booking);
  const deadlineText = formatDeadline(booking.confirmation_deadline_at);
  // El enlace discreto de incidencias en una completada no compite con el bloque grande de
  // confirmación: uno excluye al otro, nunca coinciden en la misma reserva.
  const canOpenIncidentFromCompleted = isCompleted && !awaitingConfirmation && canReportIncident(booking) && Boolean(onReportIncident);

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
          {/* F8: con varios servicios el título es más largo: hasta dos líneas. */}
          <h3 className="font-semibold text-gray-900 line-clamp-2 break-words">{serviceName}</h3>
          <p className="text-sm text-gray-600 truncate">con {gardenerName}</p>
          <WhoIsComing bookingId={booking.id} status={booking.status} date={booking.date} />
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${getBookingStatusTone(booking.status)}`}>
          {getBookingStatusLabel(booking.status, 'client')}
        </span>
      </div>

      {/* Datos del servicio en vertical: en 390 px una rejilla horizontal parte las direcciones. */}
      <dl className="mt-3 space-y-1.5 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />
          <dd className="first-letter:uppercase">
            {multiDay
              ? formatDateRange(booking.date, String(booking.end_date))
              : format(parseISO(booking.date), "EEEE, d 'de' MMMM 'de' yyyy", { locale: es })}
          </dd>
        </div>
        {formatTime(booking.start_time) && (
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />
            <dd>
              {multiDay ? `Empieza a las ${formatTime(booking.start_time)}` : formatTime(booking.start_time)}
              {!multiDay && booking.duration_hours ? ` · ${booking.duration_hours} h` : ''}
              {/* F7: en equipo o en varios días, el reloj no dice cuánto trabajo es. */}
              {booking.labour_hours ? ` · ${booking.labour_hours} h de trabajo${multiDay ? '' : ' en equipo'}` : ''}
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

      {/* F6.3 (D9): propuesta de otra fecha. Tampoco se pliega: espera respuesta. */}
      {booking.reschedule_status === 'pending_client' && booking.proposed_date && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            {gardenerFirstName} te propone cambiar la fecha a{' '}
            <strong>
              {format(parseISO(booking.proposed_date), "EEEE d 'de' MMMM", { locale: es })}
              {booking.proposed_start_time ? ` a las ${booking.proposed_start_time.slice(0, 5)}` : ''}
            </strong>.
          </p>
          {booking.reschedule_reason && (
            <p className="mt-1 text-sm text-amber-800"><span className="font-medium">Motivo:</span> {booking.reschedule_reason}</p>
          )}
          <p className="mt-1 text-xs text-amber-800">Si prefieres la fecha que tenías, no cambia nada.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => onAcceptReschedule?.(booking)} disabled={busy}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Aceptar nueva fecha
            </button>
            <button type="button" onClick={() => onRejectReschedule?.(booking)} disabled={busy}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60">
              Mantener mi fecha
            </button>
          </div>
        </div>
      )}

      {/* El cambio de precio NUNCA se pliega: mueve dinero y espera respuesta. */}
      {hasPriceChange && (
        <div className="mt-3 p-3 rounded-lg border border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">
            {gardenerFirstName} propone un nuevo precio del servicio:{' '}
            <strong>{formatEuro(booking.proposed_total_price)}</strong>
          </p>
          {/* D5: la propuesta puede traer también un cambio de duración (solo la hora de fin
              se mueve; el inicio nunca cambia). */}
          {booking.proposed_duration_hours != null
            && booking.proposed_duration_hours !== booking.duration_hours && (
            <p className="mt-1 text-sm text-amber-900">
              Y una nueva duración: <strong>{booking.proposed_duration_hours} h</strong>
              {addHoursToTime(booking.start_time, booking.proposed_duration_hours) && (
                <> (fin a las {addHoursToTime(booking.start_time, booking.proposed_duration_hours)})</>
              )}
              {booking.duration_hours != null && <> — antes {booking.duration_hours} h</>}.
            </p>
          )}
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
              className="flex-1 bg-emerald-700 px-4 py-2.5 rounded-xl text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 transition-colors inline-flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Aceptando…
                </>
              ) : (
                'Aceptar nuevo precio'
              )}
            </button>
            <button
              type="button"
              onClick={() => onRejectPriceChange?.(booking)}
              disabled={busy}
              className="flex-1 bg-white px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 transition-colors inline-flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Rechazando…
                </>
              ) : (
                'Rechazar'
              )}
            </button>
          </div>
        </div>
      )}

      {/* ¿Se hizo el trabajo?: NUNCA se pliega, igual que el cambio de precio -espera una
          respuesta antes de que la reserva se cobre sola-. Mismo lenguaje visual: ámbar, motivo
          y dos acciones. */}
      {awaitingConfirmation && (onConfirmService || onReportIncident) && (
        <div className="mt-3 p-3 rounded-lg border border-amber-200 bg-amber-50">
          <p className="text-sm font-semibold text-amber-900">¿Se hizo el trabajo?</p>
          {deadlineText && (
            <p className="mt-1 text-sm text-amber-800">
              Si no nos dices nada antes del {deadlineText}, lo daremos por completado y los
              gastos de gestión quedarán cobrados.
            </p>
          )}
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            {onConfirmService && (
              <button
                type="button"
                onClick={() => onConfirmService(booking)}
                disabled={busy}
                className="flex-1 bg-emerald-700 px-4 py-2.5 rounded-xl text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 transition-colors"
              >
                {busy ? 'Confirmando…' : 'Sí, confirmar'}
              </button>
            )}
            {onReportIncident && (
              <button
                type="button"
                onClick={() => onReportIncident(booking)}
                disabled={busy}
                className="flex-1 bg-white px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 transition-colors"
              >
                Tengo una incidencia
              </button>
            )}
          </div>
        </div>
      )}

      {/* Con una incidencia abierta: ni se cierra ni se cobra sola mientras se revisa. */}
      {isDisputed && (
        <p className="mt-3 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2.5 text-sm text-purple-900">
          Tienes una incidencia en revisión sobre este servicio. Te avisaremos por email en
          cuanto tengamos una respuesta.
        </p>
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
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 transition-colors"
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

        {/* Poca prominencia a propósito: no compite con "Volver a reservar" ni con valorar, es
            la salida para cuando algo no fue bien mucho después de cerrarse. */}
        {canOpenIncidentFromCompleted && (
          <button
            type="button"
            onClick={() => onReportIncident?.(booking)}
            className="w-full text-center text-xs font-medium text-gray-500 underline hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded"
          >
            ¿Algo no fue bien? Abre una incidencia
          </button>
        )}
      </div>
    </article>
  );
};

export default ClientBookingCard;
