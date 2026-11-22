#!/usr/bin/env node
// QA-181 · paquete 1.5: un servicio que el administrador desactiva deja de cotizarse y de firmarse en
// el SERVIDOR (no solo de verse en la web). Prueba por HTTP contra las funciones servidas en local.
//
//   supabase functions serve --env-file <env>        # otra terminal
//   node scripts/qa/verify-inactive-service.mjs
//
// Desactiva «Corte de césped» unos segundos y lo vuelve a activar al terminar (también si falla).

import {
  env, sql, signIn, PROVIDER_ID, quote, previewProviders, validHours, createQuote, nextOpenWeekdayIso,
} from '../readiness/_harness.mjs';

const { functionsUrl } = env();
const LAWN = sql("select id from public.services where name = 'Corte de césped' limit 1;").trim();
const input = { lawnZones: [{ quantity: 100, state: 'normal' }], wasteRemoval: false };
const results = [];
const record = (id, label, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${id}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const isUnavailable = (res) => res.status === 409 && res.body?.code === 'service_unavailable';

const date = nextOpenWeekdayIso();
const token = await signIn();

// Antes: activo, todo responde.
const before = await previewProviders(LAWN, input, { selectedDate: date });
record('V0', 'Activo: se ofrecen profesionales', before.ok, `${before.status}`);

try {
  sql(`update public.services set is_active = false, status = 'unavailable' where id = '${LAWN}';`);

  const preview = await previewProviders(LAWN, input, { selectedDate: date });
  record('V1', 'Desactivado: preview_providers lo rechaza con service_unavailable', isUnavailable(preview),
    `${preview.status} ${preview.body?.code} «${preview.body?.error}»`);
  record('V2', 'El mensaje nombra el servicio', String(preview.body?.error || '').includes('Corte de césped'));

  const hours = await validHours(LAWN, date, input);
  record('V3', 'Desactivado: valid_hours lo rechaza', isUnavailable(hours), `${hours.status} ${hours.body?.code}`);

  const days = await fetch(`${functionsUrl}/booking-authority`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env().anonKey },
    body: JSON.stringify({ action: 'month_days', serviceId: LAWN, providerId: PROVIDER_ID, month: date.slice(0, 7), bookingInput: input }),
  });
  const daysBody = await days.json().catch(() => ({}));
  record('V4', 'Desactivado: month_days lo rechaza', days.status === 409 && daysBody.code === 'service_unavailable', `${days.status} ${daysBody.code}`);

  const signed = await createQuote(LAWN, input, { date, startTime: '09:00', accessToken: token });
  record('V5', 'Desactivado: create_quote NO firma presupuesto', isUnavailable(signed) && !signed.body?.quoteId,
    `${signed.status} ${signed.body?.code}`);

  // Visita de varios servicios con el desactivado como secundario.
  const ARB = sql("select id from public.services where name = 'Poda de plantas y arbustos' limit 1;").trim();
  const multi = await fetch(`${functionsUrl}/booking-authority`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env().anonKey },
    body: JSON.stringify({
      action: 'preview_providers', serviceId: ARB, providerIds: [PROVIDER_ID], selectedDate: date, windowDays: 7,
      bookingInput: {}, items: [{ serviceId: ARB, bookingInput: {} }, { serviceId: LAWN, bookingInput: input }],
    }),
  });
  const multiBody = await multi.json().catch(() => ({}));
  record('V6', 'Desactivado dentro de una visita de varios servicios: se rechaza', multi.status === 409 && multiBody.code === 'service_unavailable',
    `${multi.status} ${multiBody.code}`);

  // Una reserva YA hecha se puede seguir recalculando (corrección del profesional).
  const correction = await quote(LAWN, input);
  record('V7', 'Desactivado: recalcular una reserva ya hecha sigue funcionando', correction.ok !== false && Number(correction.totalPrice ?? correction.body?.totalPrice) > 0,
    `${correction.status ?? ''} ${correction.totalPrice ?? correction.body?.totalPrice ?? ''}`);

  // Ningún presupuesto firmado para el servicio desactivado en esta prueba.
  const signedRows = sql(`select count(*) from public.booking_quotes where service_id = '${LAWN}' and generated_at > now() - interval '2 minutes';`).trim();
  record('V8', 'Ningún presupuesto firmado mientras estaba desactivado', signedRows === '0', `${signedRows} filas`);
} finally {
  sql(`update public.services set is_active = true, status = 'active' where id = '${LAWN}';`);
}

const after = await previewProviders(LAWN, input, { selectedDate: date });
record('V9', 'Reactivado: vuelve a ofrecer profesionales', after.ok, `${after.status}`);

const okCount = results.filter(Boolean).length;
console.log(`\n${okCount}/${results.length} comprobaciones OK`);
process.exit(okCount === results.length ? 0 : 1);
