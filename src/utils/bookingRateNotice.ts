import type { BookingQuoteCommission } from '../shared/commissionRules';
import { formatEuro } from '../shared/bookingAmounts';

/**
 * Cuándo y qué se le explica al cliente sobre la tarifa de su reserva (QA-100 / QA-102).
 *
 * El precio de los gastos de gestión lo decide el servidor. Hay cuatro casos en los que el cliente
 * esperaría otro y, si no se le dice nada, ve un precio que «ha subido» sin motivo:
 *   · first_rate_in_use: ya tiene otra reserva en curso con ese profesional con la tarifa de primera
 *     reserva, que vale para una sola a la vez (decisión del dueño, QA-100).
 *   · stale_link_code: entró por un enlace del profesional cuya clave ya no es la vigente.
 *   · missing_link_code: entró por la dirección del profesional sin su clave (un enlace copiado a
 *     mano o antiguo).
 *   · garser_client_already: trae la clave buena, pero su primera reserva con ese profesional fue por
 *     GarSer, y el origen de un cliente queda fijado con su primera reserva.
 * Los avisos de enlace solo salen si de verdad hay gastos que pagar.
 */
export type BookingRateNoticeKind =
  | 'first_rate_in_use'
  | 'stale_link_code'
  | 'missing_link_code'
  | 'garser_client_already';

export interface BookingRateNotice {
  kind: BookingRateNoticeKind;
  text: string;
}

export function describeBookingRateNotice(input: {
  commission: Pick<BookingQuoteCommission, 'origin' | 'linkClaim' | 'firstRateInUse'> | null | undefined;
  managementFee: number | null | undefined;
  /** La reserva empezó en el enlace de ese profesional (garser.es/reservar/<id>). */
  cameFromProviderLink: boolean;
  /** El cliente traía una clave de enlace (válida o no). */
  hadLinkCode: boolean;
  providerName?: string | null;
}): BookingRateNotice | null {
  const { commission } = input;
  if (!commission) return null;
  const name = input.providerName?.trim() || 'este profesional';
  const fee = Number(input.managementFee) || 0;

  if (commission.firstRateInUse) {
    return {
      kind: 'first_rate_in_use',
      text: `Ya tienes otra reserva en curso con ${name}. La tarifa de primera reserva vale para una sola reserva a la vez, así que esta lleva la tarifa de las reservas siguientes${fee > 0 ? ` (${formatEuro(fee)} de gastos de gestión)` : ''}. Si la otra se cancela antes de hacerse, vuelve a estar disponible.`,
    };
  }

  if (!input.cameFromProviderLink || commission.origin !== 'garser' || fee <= 0) return null;

  if (commission.linkClaim === 'rejected') {
    return input.hadLinkCode
      ? {
          kind: 'stale_link_code',
          text: `Este enlace ya no es el vigente de ${name}, así que esta reserva lleva los gastos de gestión de GarSer (${formatEuro(fee)}). Si eres cliente suyo, pídele su enlace actualizado.`,
        }
      : {
          kind: 'missing_link_code',
          text: `Esta dirección no es el enlace personal de reserva de ${name} (le falta su clave), así que esta reserva lleva los gastos de gestión de GarSer (${formatEuro(fee)}). Si eres cliente suyo, pídele su enlace o su código QR.`,
        };
  }

  if (commission.linkClaim === 'verified') {
    return {
      kind: 'garser_client_already',
      text: `Tu primera reserva con ${name} la hiciste a través de GarSer, así que tus reservas con ${name} llevan los gastos de gestión de GarSer (${formatEuro(fee)}), aunque entres por su enlace.`,
    };
  }

  return null;
}
