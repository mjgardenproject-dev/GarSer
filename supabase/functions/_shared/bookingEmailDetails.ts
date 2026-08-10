// Detalles de una reserva para los emails, resueltos SIEMPRE en el servidor.
//
// Antes cada funcion de email componia sus propias filas: booking-confirmation-email leia
// total_price de la BD y mandaba la misma fila 'Total' al cliente y al jardinero, mientras
// send-email-notification recibia un `priceText` ya formateado DESDE EL NAVEGADOR. Resultado:
// dos formatos de euro distintos para la misma reserva, un importe de dinero compuesto en un
// cliente no confiable, y un "Total" que significaba cosas distintas segun quien lo leyera.
//
// Aqui se resuelve una sola vez, con la fuente de verdad de src/shared/bookingAmounts.ts.

import {
  BOOKING_AMOUNT_LABELS,
  GARDENER_AMOUNT_NOTE,
  clientAmountsNote,
  formatEuro,
  getBookingAmounts,
} from '../../../src/shared/bookingAmounts.ts';
import { formatBookingDate } from './emailBrand.ts';

export type DetailPair = [string, string];

export interface BookingEmailRecipient {
  email: string | null;
  name: string;
}

export interface BookingEmailDetails {
  booking: {
    id: string;
    client_id: string | null;
    gardener_id: string | null;
    status: string;
    date: string | null;
    start_time: string | null;
    total_price: number | null;
    management_fee: number | null;
    management_fee_source: string | null;
    client_address: string | null;
    proposed_total_price: number | null;
    proposed_price_reason: string | null;
  };
  serviceName: string;
  whenText: string;
  address: string;
  client: BookingEmailRecipient;
  gardener: BookingEmailRecipient;
  /** Filas del CAMBIO DE PRECIO propuesto (nuevo precio, nuevo total y motivo). */
  priceChangeClientPairs: DetailPair[];
  /** Filas del cambio de precio para el JARDINERO: su nuevo importe, íntegro. */
  priceChangeGardenerPairs: DetailPair[];
  /** Filas para el CLIENTE: total de la reserva + lo que le queda por pagar al profesional. */
  clientPairs: DetailPair[];
  /** Filas para el JARDINERO: unicamente lo que va a cobrar, integro. */
  gardenerPairs: DetailPair[];
  /** Aclaracion sobre el estado de los gastos de gestion (retenidos / cobrados / liberados). */
  clientFeeNote: string;
}

const BOOKING_COLUMNS =
  'id, client_id, gardener_id, service_id, status, date, start_time, total_price, management_fee, management_fee_source, client_address, proposed_total_price, proposed_price_reason';

// deno-lint-ignore no-explicit-any
type AdminClient = any;

async function resolveRecipient(admin: AdminClient, userId: string | null): Promise<BookingEmailRecipient> {
  if (!userId) return { email: null, name: '' };
  let email: string | null = null;
  const { data: userData } = await admin.auth.admin.getUserById(userId);
  if (userData?.user?.email) email = userData.user.email;
  let name = '';
  const { data: profile } = await admin.from('profiles').select('full_name').eq('id', userId).single();
  if (profile?.full_name) name = profile.full_name;
  return { email, name };
}

/**
 * Lee la reserva y devuelve los bloques de detalle ya listos por audiencia.
 * Devuelve `null` si la reserva no existe.
 */
export async function buildBookingEmailDetails(
  admin: AdminClient,
  bookingId: string,
): Promise<BookingEmailDetails | null> {
  const { data: booking, error } = await admin
    .from('bookings')
    .select(BOOKING_COLUMNS)
    .eq('id', bookingId)
    .single();

  if (error || !booking) return null;

  let serviceName = 'Servicio de jardinería';
  if (booking.service_id) {
    const { data: service } = await admin.from('services').select('name').eq('id', booking.service_id).single();
    if (service?.name) serviceName = service.name;
  }

  const whenText = formatBookingDate(booking.date, booking.start_time);
  const address = booking.client_address || 'Dirección indicada en la reserva';
  const amounts = getBookingAmounts(booking);
  const [client, gardener] = await Promise.all([
    resolveRecipient(admin, booking.client_id),
    resolveRecipient(admin, booking.gardener_id),
  ]);

  const base: DetailPair[] = [
    ['Servicio', serviceName],
    ['Fecha', whenText],
    ['Dirección', address],
  ];

  // Cliente: las dos cifras que necesita para no confundirse. Si no consta una comision
  // fiable (reservas anteriores a la columna) se muestra solo el precio del servicio: es
  // preferible dar menos informacion que dar una cifra inventada.
  const clientPairs: DetailPair[] = amounts.feeIsKnown
    ? [
        ...base,
        [BOOKING_AMOUNT_LABELS.clientTotal, formatEuro(amounts.clientTotal)],
        [
          booking.status === 'completed'
            ? BOOKING_AMOUNT_LABELS.paidToGardener
            : BOOKING_AMOUNT_LABELS.pendingToGardener,
          formatEuro(amounts.pendingToGardener),
        ],
      ]
    : [...base, [BOOKING_AMOUNT_LABELS.servicePrice, formatEuro(amounts.servicePrice)]];

  // Jardinero: solo su importe. Mezclar aqui el total del cliente o la comision solo genera
  // dudas sobre si se le descuenta algo, cuando cobra el 100 %.
  const gardenerPairs: DetailPair[] = [
    ...base,
    [`${BOOKING_AMOUNT_LABELS.gardenerReceives} (íntegro)`, formatEuro(amounts.gardenerReceives)],
  ];

  // Cambio de precio (paso 8B). Se calcula aqui, con el mismo motor y el mismo formato de
  // euro que el resto: el importe propuesto NO puede componerse en el navegador ni con otro
  // formateador. Los gastos de gestion ya abonados no se recobran, por eso el nuevo total
  // del cliente se deriva del precio propuesto manteniendo la comision existente.
  const proposed = Number(booking.proposed_total_price);
  const hasProposal = Number.isFinite(proposed) && proposed > 0;
  const proposedAmounts = hasProposal
    ? getBookingAmounts({ ...booking, total_price: proposed })
    : null;

  const priceChangeClientPairs: DetailPair[] = hasProposal
    ? [
        ...base,
        ['Precio del servicio propuesto', formatEuro(proposed)],
        ...(proposedAmounts && proposedAmounts.feeIsKnown
          ? [[`Nuevo ${BOOKING_AMOUNT_LABELS.clientTotal.toLowerCase()}`, formatEuro(proposedAmounts.clientTotal)] as DetailPair]
          : []),
        ...(booking.proposed_price_reason
          ? [['Motivo', String(booking.proposed_price_reason)] as DetailPair]
          : []),
      ]
    : base;

  const priceChangeGardenerPairs: DetailPair[] = hasProposal
    ? [...base, [`${BOOKING_AMOUNT_LABELS.gardenerReceives} (íntegro)`, formatEuro(proposed)]]
    : gardenerPairs;

  return {
    booking,
    serviceName,
    whenText,
    address,
    client,
    gardener,
    clientPairs,
    gardenerPairs,
    priceChangeClientPairs,
    priceChangeGardenerPairs,
    clientFeeNote: clientAmountsNote(amounts),
  };
}

export { GARDENER_AMOUNT_NOTE };
