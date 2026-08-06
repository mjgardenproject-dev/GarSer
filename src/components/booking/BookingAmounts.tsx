import {
  BOOKING_AMOUNT_LABELS,
  GARDENER_AMOUNT_NOTE,
  clientAmountsNote,
  formatEuro,
  getBookingAmounts,
  type BookingAmounts,
  type BookingAmountsRow,
} from '../../shared/bookingAmounts';

/**
 * Presentacion unica de los importes de una reserva.
 *
 * Existe para que ninguna pantalla vuelva a inventar etiquetas: el cliente ve siempre el total
 * de la reserva Y lo que le queda por pagar al profesional, y el jardinero ve siempre su
 * importe integro. Antes cada tarjeta pintaba `€{total_price}` a pelo, sin decir de que era esa
 * cifra, y el mismo numero significaba cosas distintas segun la pantalla.
 */

interface ClientBookingAmountsProps {
  booking: BookingAmountsRow;
  /** `card` para tarjetas de reserva; `checkout` para el resumen de pago, mas destacado. */
  variant?: 'card' | 'checkout';
  className?: string;
}

export function ClientBookingAmounts({ booking, variant = 'card', className = '' }: ClientBookingAmountsProps) {
  const amounts = getBookingAmounts(booking);
  const note = clientAmountsNote(amounts);
  const isCheckout = variant === 'checkout';
  const isSettled = String(booking.status || '').toLowerCase() === 'completed';
  const isVoid = amounts.feeState === 'void';

  const pendingLabel = isSettled
    ? BOOKING_AMOUNT_LABELS.paidToGardener
    : BOOKING_AMOUNT_LABELS.pendingToGardener;

  return (
    <div className={`rounded-xl border border-gray-200 bg-gray-50/60 p-3 sm:p-4 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-gray-600 ${isCheckout ? 'text-sm font-medium' : 'text-xs sm:text-sm'}`}>
          {amounts.feeIsKnown ? BOOKING_AMOUNT_LABELS.clientTotal : BOOKING_AMOUNT_LABELS.servicePrice}
        </span>
        <span
          className={`font-bold tabular-nums text-gray-900 ${isCheckout ? 'text-2xl sm:text-[2rem] leading-none' : 'text-lg'}`}
        >
          {formatEuro(amounts.clientTotal)}
        </span>
      </div>

      {/* Se omite cuando no queda nada pendiente (reserva cancelada) y cuando no consta
          comision fiable, porque entonces esta cifra seria identica a la de arriba: repetir
          el mismo importe con dos nombres es justo la ambiguedad que este bloque elimina. */}
      {!isVoid && amounts.feeIsKnown && (
        <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-gray-200 pt-2">
          <span className={`text-gray-600 ${isCheckout ? 'text-sm font-medium' : 'text-xs sm:text-sm'}`}>
            {pendingLabel}
          </span>
          <span
            className={`font-semibold tabular-nums text-green-700 ${isCheckout ? 'text-xl sm:text-2xl leading-none' : 'text-base'}`}
          >
            {formatEuro(amounts.pendingToGardener)}
          </span>
        </div>
      )}

      {note && <p className="mt-2 text-[11px] leading-4 text-gray-500 sm:text-xs">{note}</p>}
    </div>
  );
}

interface GardenerBookingAmountProps {
  booking: BookingAmountsRow;
  /** `compact` para filas de lista; `hero` para la tarjeta de solicitud entrante. */
  variant?: 'compact' | 'hero';
  className?: string;
}

/**
 * El jardinero ve SOLO lo que va a cobrar. Nunca el total del cliente ni la comision: su
 * importe es integro y mezclarlo con la tarifa del cliente solo genera dudas sobre si se le
 * descuenta algo.
 */
export function GardenerBookingAmount({ booking, variant = 'compact', className = '' }: GardenerBookingAmountProps) {
  const amounts = getBookingAmounts(booking);
  const isHero = variant === 'hero';

  if (isHero) {
    return (
      <div className={`sm:text-right ${className}`}>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {BOOKING_AMOUNT_LABELS.gardenerReceives}
        </div>
        <div className="text-xl font-bold text-green-600 whitespace-nowrap sm:text-2xl">
          {formatEuro(amounts.gardenerReceives)}
        </div>
        <div className="mt-1 max-w-[16rem] text-[11px] leading-4 text-gray-500 sm:ml-auto">
          {GARDENER_AMOUNT_NOTE}
        </div>
      </div>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md bg-green-50 px-2 py-1 font-semibold text-green-700 ${className}`}
      title={GARDENER_AMOUNT_NOTE}
    >
      <span className="text-[11px] font-medium uppercase tracking-wide text-green-800/70">
        {BOOKING_AMOUNT_LABELS.gardenerReceives}
      </span>
      {formatEuro(amounts.gardenerReceives)}
    </span>
  );
}

export type { BookingAmounts };
