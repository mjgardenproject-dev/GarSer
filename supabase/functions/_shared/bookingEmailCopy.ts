// Textos de los correos de reserva que dependen del estado de la reserva (H-37). Sin
// dependencias de Deno: lo usan send-email-notification y booking-confirmation-email, y lo
// prueba vitest (src/shared/bookingEmailCopy.test.ts).

export type CancellationActor = 'client' | 'gardener' | 'system' | null | undefined;
export type EmailAudience = 'client' | 'gardener';

/**
 * Cancelación: quién la hizo, dicho a quien la recibe. Antes siempre decía «Te confirmamos
 * que la siguiente reserva ha quedado cancelada», como si la hubiera cancelado el propio
 * destinatario, y llevaba el importe («Cobrarás 60 €») de un trabajo que ya no se hace.
 */
export function cancellationCopy(params: {
  actor: CancellationActor;
  audience: EmailAudience;
  counterpartName?: string | null;
  reason?: string | null;
}): { intro: string; footerNote: string } {
  const other = String(params.counterpartName || '').trim();
  const reason = String(params.reason || '').trim();
  let intro: string;
  if (params.audience === 'gardener') {
    intro = params.actor === 'client'
      ? `${other || 'El cliente'} ha cancelado esta reserva:`
      : 'Esta reserva ha quedado cancelada:';
  } else {
    intro = params.actor === 'gardener'
      ? `${other || 'El profesional'} ha cancelado tu reserva:`
      : params.actor === 'client'
        ? 'Te confirmamos que has cancelado esta reserva:'
        : 'Tu reserva ha quedado cancelada:';
  }
  const freed = params.audience === 'gardener'
    ? 'Esas horas vuelven a estar libres en tu agenda.'
    : 'Puedes hacer una nueva reserva cuando quieras.';
  return { intro, footerNote: reason ? `Motivo: ${reason} · ${freed}` : freed };
}

/**
 * Propuesta de cambio de precio con nueva duración: «4 h (fin a las 13:00) — antes 3 h», igual
 * que lo enseña la web. `null` si la propuesta no cambia la duración.
 */
export function proposedDurationText(params: {
  startTime: string | null | undefined;
  durationHours: number | null | undefined;
  proposedDurationHours: number | null | undefined;
}): string | null {
  const proposed = Number(params.proposedDurationHours);
  const current = Number(params.durationHours);
  if (!Number.isFinite(proposed) || proposed <= 0 || proposed === current) return null;
  const [h, m] = String(params.startTime || '').split(':').map(Number);
  const end = Number.isFinite(h)
    ? ` (fin a las ${String(h + proposed).padStart(2, '0')}:${String(Number.isFinite(m) ? m : 0).padStart(2, '0')})`
    : '';
  const before = Number.isFinite(current) && current > 0 ? ` — antes ${current} h` : '';
  return `${proposed} h${end}${before}`;
}

/**
 * «Nueva reserva confirmada» al jardinero cuando se cobran los gastos de gestión. Si la reserva
 * se confirmó porque el cliente aceptó el precio que propuso el jardinero, ese ya recibió «El
 * cliente ha aceptado tu nuevo precio» en el mismo momento: no se le repite el aviso.
 */
export function shouldSendGardenerConfirmation(booking: { price_change_status?: string | null }): boolean {
  return booking.price_change_status !== 'accepted';
}
