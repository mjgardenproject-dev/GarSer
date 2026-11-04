// Comisiones configurables (2026-11): verificación de punta a punta contra el entorno LOCAL, por los
// caminos reales (booking-authority, booking-payment, las RPC y la API REST), con Stripe en modo TEST.
//
//   supabase functions serve --workdir "$(pwd)"   # en otra terminal
//   node scripts/commissions/verify-commissions.mjs
//
// ESTADO: escrito junto con las migraciones 20261102*, pero NO EJECUTADO todavía: la máquina donde se
// escribió tenía Docker sin responder, así que no había pila local. Las migraciones y toda la lógica
// SQL sí se han probado (scripts/commissions/pglite-sql-tests.mjs); lo que este script añade es
// comprobar la unión real con las edge functions y con Stripe. Si algún escenario falla, mirar primero
// si es un fallo del propio script antes de culpar a la funcionalidad.
//
// Escenarios (ver docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md, sección 29):
//   A  primera reserva de un cliente captado por GarSer → 12,5 %, Stripe por ese importe, instantánea y origen
//   B  primera reserva por el enlace del profesional → 0 €, sin Stripe, origen «enlace»
//   C  reserva posterior (GarSer) → 3 %; el cliente no puede declararse «enlace» después
//   D  reserva posterior de un cliente del enlace → 0 %
//   E  visita de un plan → 3 % (también para un cliente del enlace)
//   F  un cambio en la configuración: presupuestos nuevos con el nuevo %, los firmados y las reservas, intactos
//   G  suelo de 0,50 €
//   H  manipulaciones desde el navegador: porcentaje, importe, regla, recurrencia, tablas, RPC de admin
//   I  sin configuración válida: 503 recuperable, sin cobrar
//
// Deja la configuración como estaba y borra todo lo que crea. Se niega a correr fuera de 127.0.0.1.

import { randomUUID } from 'node:crypto';
import { env, sql, signIn, PROVIDER_ID, GARDENER_EMAIL } from '../readiness/_harness.mjs';

const { apiUrl, functionsUrl, anonKey } = env();
if (!/^http:\/\/127\.0\.0\.1:/.test(apiUrl)) {
  console.error(`Me niego a correr contra ${apiUrl}: esta verificación crea y borra reservas y cambia comisiones.`);
  process.exit(2);
}

const LAWN = sql("select id from public.services where name = 'Corte de césped' limit 1;").trim();
const INPUT = {
  serviceIds: [LAWN],
  lawnZones: [{ quantity: 300, state: 'normal' }],
  wasteRemoval: false,
  address: 'Marbella centro',
  addressCoordinates: { lat: 36.51, lng: -4.882 },
};
const CAPS = { clientCapabilities: { feeWaiver: 1 } };
const LINK = { bookingOrigin: 'provider_link', originProviderId: PROVIDER_ID };
const COLUMNS = ['rate_garser_first', 'rate_link_first', 'rate_garser_repeat', 'rate_maintenance_visit', 'rate_link_repeat'];

const created = { bookings: new Set(), attempts: new Set(), quotes: new Set(), plans: new Set(), users: new Set() };
const results = [];
const record = (id, description, ok, detail) => {
  results.push({ id, ok });
  console.log(`${ok ? '✅' : '❌'} ${id}  ${description}${detail ? `  — ${detail}` : ''}`);
};
const ids = (set) => [...set].map((id) => `'${id}'`).join(',');
const euros = (cents) => Math.round(cents) / 100;

async function callFunction(name, body, token) {
  const res = await fetch(`${functionsUrl}/${name}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token || anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, body: data };
}
const authority = (body, token) => callFunction('booking-authority', body, token);
const payment = (body, token) => callFunction('booking-payment', body, token);
async function rest(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${apiUrl}/rest/v1/${path}`, {
    method,
    headers: { apikey: anonKey, Authorization: `Bearer ${token || anonKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, body: data };
}
const rpc = (fn, args, token) => rest(`rpc/${fn}`, { method: 'POST', body: args, token });

async function signUpTempClient(label) {
  const email = `cliente-${label}-${Date.now()}@comisiones.local`;
  const res = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test123456!', data: { role: 'client', full_name: `Cliente ${label}` } }),
  });
  const body = await res.json();
  const id = body?.user?.id ?? body?.id;
  if (!id || !body.access_token) throw new Error(`No se pudo crear el cliente de prueba: ${JSON.stringify(body).slice(0, 160)}`);
  created.users.add(id);
  return { id, token: body.access_token };
}

const readConfig = () => sql(`select ${COLUMNS.join(', ')} from public.commission_settings where id = 1`).split('|').map(Number);
const setRates = (values) => sql(`update public.commission_settings set ${COLUMNS.map((c, i) => `${c} = ${values[i]}`).join(', ')} where id = 1`);
const configVersion = () => Number(sql('select version from public.commission_settings where id = 1'));

function pickDate() {
  const date = sql(`select date::text from public.availability
    where gardener_id='${PROVIDER_ID}' and date >= current_date + 3
    group by date having count(*) filter (where is_available) >= 10
    order by date limit 1`);
  if (!date) throw new Error('No hay ningún día con 10+ horas libres a partir de dentro de 3 días.');
  return date;
}

async function quoteFor({ token, date, hour, extra = {} }) {
  const q = await authority({
    action: 'create_quote', serviceId: LAWN, providerId: PROVIDER_ID, date,
    startTime: `${String(hour).padStart(2, '0')}:00`, bookingInput: INPUT, ...extra,
  }, token);
  if (q.body?.quoteId) created.quotes.add(q.body.quoteId);
  return q;
}

async function prepare(token, quoteId) {
  const res = await payment({ action: 'prepare_payment', quoteId }, token);
  const attempt = res.body?.attempt;
  if (attempt?.attemptId) created.attempts.add(attempt.attemptId);
  if (attempt?.bookingId) created.bookings.add(attempt.bookingId);
  return res;
}

// El webhook de Stripe se simula llamando a la misma RPC que él (como verify-fee-waiver).
function confirmPaid(attempt) {
  const conf = JSON.parse(sql(`select public.confirm_booking_payment_attempt('${attempt.attemptId}', 'evt_comisiones_${randomUUID()}', '${attempt.paymentIntentId}', ${attempt.payableNowAmountCents}, 'eur', '{}'::jsonb)::text`));
  if (conf.bookingId) created.bookings.add(conf.bookingId);
  return conf.bookingId;
}

const bookingRow = (id) => {
  const [fee, source, status, rule, bps, base, version, fixed, gateway] = sql(`select management_fee, management_fee_source, status,
    coalesce(commission_rule,''), coalesce(commission_rate_bps::text,''), coalesce(commission_base_amount::text,''),
    coalesce(commission_config_version::text,''), (commission_fixed_at is not null)::text, coalesce(pricing_context->>'payment_gateway_source','')
    from public.bookings where id='${id}'`).split('|');
  return { fee: Number(fee), source, status, rule, bps: Number(bps), base: Number(base), version: Number(version), fixed: fixed === 'true', gateway };
};
const origin = (clientId) => sql(`select coalesce(origin,'') from public.client_provider_relationships where client_id='${clientId}' and provider_id='${PROVIDER_ID}'`);

async function main() {
  const configBefore = readConfig();
  const versionBefore = configVersion();
  console.log(`Configuración antes: ${configBefore.join(' / ')} % (versión ${versionBefore}); se restaura al final.\n`);
  try {
    setRates([12.5, 0, 3, 3, 0]); // los valores iniciales del sistema
    const gardenerToken = await signIn(GARDENER_EMAIL);
    const date = pickDate();
    const vh = await authority({ action: 'valid_hours', serviceId: LAWN, providerId: PROVIDER_ID, date, bookingInput: INPUT, ...CAPS });
    const hours = vh.body?.validHours ?? [];
    if (hours.length < 6) throw new Error(`El ${date} no tiene 6 horas válidas: ${JSON.stringify(hours)}`);
    // Las horas que se PAGAN (cada una bloquea su hueco) son distintas; los presupuestos que no se pagan
    // comparten la última (pedir un presupuesto no reserva nada).
    const [hA, hF, hB, hC] = hours;
    const hQ = hours[hours.length - 1];
    console.log(`Día de prueba ${date}; horas ${hours.join(',')}\n`);
    const garser = await signUpTempClient('garser');
    const linked = await signUpTempClient('enlace');

    // ── A · primera reserva de un cliente captado por GarSer ───────────────────────
    const aQuote = await quoteFor({ token: garser.token, date, hour: hA, extra: CAPS });
    const aEcon = aQuote.body?.economics;
    const aFee = aEcon?.managementFee;
    record('A1', 'Primera reserva (GarSer): regla garser_first al 12,5 % sobre el precio del servicio',
      aEcon?.commission?.rule === 'garser_first' && aEcon?.commission?.rateBps === 1250 && !aEcon?.feeWaiver
      && Math.abs(aFee - aQuote.body.totalPrice * 0.125) < 0.011 && aEcon?.commission?.configVersion === configVersion(),
      JSON.stringify(aEcon?.commission));
    const aPrep = await prepare(garser.token, aQuote.body?.quoteId);
    const aAttempt = aPrep.body?.attempt;
    record('A2', 'Stripe recibe exactamente la comisión firmada (céntimos)',
      aPrep.ok && Boolean(aPrep.body?.clientSecret) && aAttempt?.payableNowAmountCents === Math.round(aFee * 100),
      `estado ${aAttempt?.status}, ${aAttempt?.payableNowAmountCents} cént. vs ${Math.round(aFee * 100)}${aPrep.ok ? '' : ` (${JSON.stringify(aPrep.body).slice(0, 140)})`}`);
    let aBooking = null;
    if (aAttempt?.attemptId && aAttempt?.paymentIntentId) {
      aBooking = confirmPaid(aAttempt);
      const row = aBooking ? bookingRow(aBooking) : null;
      record('A3', 'La reserva guarda comisión, regla, porcentaje, base, versión y fecha de fijación',
        Boolean(row) && row.fee === aFee && row.source === 'payment_attempt' && row.rule === 'garser_first' && row.bps === 1250
        && row.base === aQuote.body.totalPrice && row.version === aEcon.commission.configVersion && row.fixed && row.gateway === 'stripe_elements',
        JSON.stringify(row));
      record('A4', 'Se guarda el origen del cliente con ese profesional: GarSer', origin(garser.id) === 'garser', origin(garser.id));
    }

    // ── F · un cambio de configuración (con la reserva A ya hecha y un presupuesto en curso) ─────
    const fPending = await quoteFor({ token: linked.token, date, hour: hF, extra: CAPS }); // firmado ANTES del cambio
    setRates([20, 0, 4, 3, 0]);
    // Un cliente NUEVO (aún sin reservas con este profesional) → «primera reserva (GarSer)» al 20 % nuevo.
    const fNewClient = await signUpTempClient('cambio');
    const fNew = await quoteFor({ token: fNewClient.token, date, hour: hQ, extra: CAPS });
    record('F1', 'Tras el cambio, el presupuesto nuevo usa la configuración nueva (y la versión nueva)',
      fNew.body?.economics?.commission?.rule === 'garser_first' && fNew.body.economics.commission.rateBps === 2000
      && fNew.body.economics.commission.configVersion === configVersion(),
      JSON.stringify(fNew.body?.economics?.commission));
    const fPendingFee = fPending.body?.economics?.managementFee;
    const fPendingPrep = await prepare(linked.token, fPending.body?.quoteId);
    record('F2', 'El presupuesto firmado ANTES del cambio se puede pagar con el porcentaje con el que se firmó',
      fPendingPrep.ok && fPendingPrep.body?.attempt?.payableNowAmountCents === Math.round(fPendingFee * 100),
      `${fPendingPrep.status} ${JSON.stringify(fPendingPrep.body).slice(0, 160)}`);
    if (aBooking) {
      const row = bookingRow(aBooking);
      record('F3', 'Las reservas anteriores conservan comisión, regla y versión', row.fee === aFee && row.rule === 'garser_first' && row.bps === 1250, JSON.stringify(row));
    }
    setRates([12.5, 0, 3, 3, 0]);

    // ── B · primera reserva por el enlace del profesional ───────────────────────────
    const bQuote = await quoteFor({ token: linked.token, date, hour: hB, extra: { ...CAPS, ...LINK } });
    const bEcon = bQuote.body?.economics;
    record('B1', 'Por el enlace: regla link_first al 0 %, sin gastos y con motivo',
      bEcon?.commission?.rule === 'link_first' && bEcon?.managementFee === 0 && bEcon?.payableNow === 0 && bEcon?.feeWaiver?.reason === 'provider_link',
      JSON.stringify(bEcon?.commission));
    const bPrep = await prepare(linked.token, bQuote.body?.quoteId);
    const bBooking = bPrep.body?.attempt?.bookingId;
    record('B2', 'Confirmar crea la reserva YA, sin Stripe, con origen «enlace»',
      bPrep.ok && Boolean(bBooking) && !bPrep.body?.clientSecret && bookingRow(bBooking).source === 'waived_provider_link' && bookingRow(bBooking).gateway === 'none'
      && origin(linked.id) === 'provider_link', JSON.stringify(bBooking ? bookingRow(bBooking) : bPrep.body).slice(0, 200));
    const bAgain = await prepare(linked.token, bQuote.body?.quoteId);
    record('B3', 'Un doble envío no duplica la reserva', bAgain.body?.attempt?.bookingId === bBooking
      && sql(`select count(*) from public.bookings where pricing_context->>'quote_id'='${bQuote.body.quoteId}'`) === '1');

    // ── C/D · reservas posteriores ──────────────────────────────────────────────────
    if (aBooking && bBooking) {
      sql(`update public.bookings set status = 'completed' where id in ('${aBooking}', '${bBooking}')`);
      const cQuote = await quoteFor({ token: garser.token, date, hour: hC, extra: CAPS });
      record('C1', 'Cliente de GarSer que repite: regla garser_repeat al 3 %', cQuote.body?.economics?.commission?.rule === 'garser_repeat' && cQuote.body?.economics?.commission?.rateBps === 300,
        JSON.stringify(cQuote.body?.economics?.commission));
      const cClaim = await quoteFor({ token: garser.token, date, hour: hQ, extra: { ...CAPS, ...LINK } });
      record('C2', 'Un cliente de GarSer que ahora entra por el enlace NO cambia su origen ni consigue el 0 %',
        cClaim.body?.economics?.commission?.rule === 'garser_repeat' && cClaim.body?.economics?.commission?.origin === 'garser', JSON.stringify(cClaim.body?.economics?.commission));
      const cPrep = await prepare(garser.token, cQuote.body?.quoteId);
      record('C3', 'Stripe cobra el 3 %', cPrep.ok && cPrep.body?.attempt?.payableNowAmountCents === Math.round(cQuote.body.economics.managementFee * 100),
        JSON.stringify(cPrep.body).slice(0, 160));
      const dQuote = await quoteFor({ token: linked.token, date, hour: hQ, extra: CAPS });
      record('D1', 'Cliente del enlace que repite (aunque ahora no declare enlace): link_repeat al 0 %',
        dQuote.body?.economics?.commission?.rule === 'link_repeat' && dQuote.body?.economics?.managementFee === 0, JSON.stringify(dQuote.body?.economics?.commission));

      // ── E · visita de un plan: 3 %, también para un cliente del enlace ────────────
      const plan = await rpc('create_maintenance_plan', { p_booking_id: bBooking, p_frequency: 'weekly' }, linked.token);
      const planId = plan.body?.planId;
      if (planId) {
        created.plans.add(planId);
        sql(`update public.maintenance_plans set next_visit_date = current_date + 3 where id='${planId}'`);
        sql('select public.generate_maintenance_proposals()');
        const visitQuote = sql(`select q.id from public.maintenance_visits v join public.booking_quotes q on q.id = v.quote_id where v.plan_id='${planId}' and v.status='proposed' limit 1`);
        if (visitQuote) {
          created.quotes.add(visitQuote);
          const vEcon = JSON.parse(sql(`select economic_snapshot::text from public.booking_quotes where id='${visitQuote}'`));
          record('E1', 'La visita del plan de un cliente del enlace paga la regla del plan (3 %)',
            vEcon.commission?.rule === 'maintenance_visit' && vEcon.commission?.rateBps === 300 && vEcon.commission?.origin === 'provider_link'
            && sql(`select public.maintenance_quote_is_intact('${visitQuote}')`) === 't', JSON.stringify(vEcon.commission));
          const vPrep = await prepare(linked.token, visitQuote);
          record('E2', 'Stripe cobra la comisión de la visita', vPrep.ok && vPrep.body?.attempt?.payableNowAmountCents === Math.round(vEcon.managementFee * 100),
            JSON.stringify(vPrep.body).slice(0, 160));
        } else {
          record('E1', 'Propuesta de visita del plan', false, 'el generador no propuso visita (¿sin hueco esa semana?)');
        }
      } else {
        record('E0', 'Crear un plan desde la reserva completada', false, JSON.stringify(plan.body).slice(0, 160));
      }
    }

    // ── G · suelo de 0,50 € (Stripe no cobra menos) ─────────────────────────────────
    setRates([0.01, 0, 3, 3, 0]);
    const gClient = await signUpTempClient('suelo');
    const gQuote = await quoteFor({ token: gClient.token, date, hour: hQ, extra: CAPS });
    const gEcon = gQuote.body?.economics;
    record('G1', 'Con una comisión calculada por debajo de 0,50 €, se cobra 0,50 € y queda registrado el ajuste',
      gEcon?.managementFee === 0.5 && gEcon?.commission?.adjustment === 'minimum_charge' && gEcon?.commission?.calculatedAmount < 0.5,
      JSON.stringify(gEcon?.commission));
    setRates([12.5, 0, 3, 3, 0]);

    // ── H · manipulaciones desde el navegador ───────────────────────────────────────
    const hQuote = await quoteFor({
      token: (await signUpTempClient('manipulador')).token, date, hour: hQ,
      extra: { ...CAPS, commissionRate: 0, rateBps: 0, managementFee: 0, commission: { rule: 'link_first', rateBps: 0 }, isReturningClient: true, bookingOrigin: 'garser' },
    });
    record('H1', 'Un presupuesto con porcentaje, importe, regla y «cliente recurrente» manipulados en la petición los ignora',
      hQuote.body?.economics?.commission?.rule === 'garser_first' && hQuote.body?.economics?.commission?.rateBps === 1250 && hQuote.body?.economics?.managementFee > 0,
      JSON.stringify(hQuote.body?.economics?.commission));
    const otherLink = await quoteFor({ token: (await signUpTempClient('otro-enlace')).token, date, hour: hQ, extra: { ...CAPS, bookingOrigin: 'provider_link', originProviderId: randomUUID() } });
    record('H2', 'El enlace de OTRO profesional no cuenta con éste', otherLink.body?.economics?.commission?.origin === 'garser');
    if (aBooking) {
      const patch = await rest(`bookings?id=eq.${aBooking}`, { method: 'PATCH', body: { management_fee: 0, commission_rate_bps: 0, commission_rule: 'link_first' }, token: garser.token });
      record('H3', 'Un cliente no puede reescribir la comisión de su reserva por la API REST', !patch.ok || (Array.isArray(patch.body) && patch.body.length === 0), `${patch.status} ${JSON.stringify(patch.body).slice(0, 120)}`);
      record('H3b', 'Y la reserva sigue como estaba', bookingRow(aBooking).fee === aFee && bookingRow(aBooking).rule === 'garser_first');
    }
    const forged = await rest('booking_quotes', { method: 'POST', body: { client_id: garser.id, gardener_id: PROVIDER_ID, service_id: LAWN, signature: randomUUID(), economic_snapshot: { payableNow: 0.5 } }, token: garser.token });
    record('H4', 'Un cliente no puede fabricar un presupuesto por la API REST', !forged.ok, `${forged.status}`);
    const configJustBefore = readConfig().join();
    const readCfg = await rpc('get_commission_settings', {}, garser.token);
    const saveCfg = await rpc('save_commission_settings', { p_expected_version: configVersion(), p_rates: { garser_first: 0, link_first: 0, garser_repeat: 0, maintenance_visit: 0, link_repeat: 0 } }, garser.token);
    const readAnon = await rpc('get_commission_settings', {}, undefined);
    record('H5', 'Un usuario no admin no puede consultar ni guardar las comisiones (ni sin sesión)', !readCfg.ok && !saveCfg.ok && !readAnon.ok && readConfig().join() === configJustBefore, `${readCfg.status}/${saveCfg.status}/${readAnon.status}`);
    const directRead = await rest('commission_settings?select=*', { token: garser.token });
    record('H6', 'Las tablas de comisiones no se leen directamente desde el navegador', !directRead.ok || (Array.isArray(directRead.body) && directRead.body.length === 0), `${directRead.status}`);
    const rates = await rpc('resolve_booking_commission', { p_client_id: null, p_provider_id: PROVIDER_ID, p_claimed_origin: 'provider_link' }, garser.token);
    record('H7', 'La función que decide la comisión no se puede llamar desde el navegador', !rates.ok, `${rates.status}`);

    // ── I · sin configuración válida ────────────────────────────────────────────────
    const saved = sql(`select version, ${COLUMNS.join(', ')}, created_at from public.commission_settings where id = 1`).split('|');
    try {
      sql('alter table public.commission_settings disable trigger trg_commission_settings_no_delete');
      sql('delete from public.commission_settings');
      const iQuote = await quoteFor({ token: garser.token, date, hour: hQ, extra: CAPS });
      record('I1', 'Sin configuración, el presupuesto se bloquea con un error recuperable (503) y no se firma nada', iQuote.status === 503 && iQuote.body?.code === 'commission_unavailable' && !iQuote.body?.quoteId, `${iQuote.status} ${JSON.stringify(iQuote.body).slice(0, 140)}`);
      const iPreview = await authority({ action: 'preview_providers', serviceId: LAWN, providerIds: [PROVIDER_ID], selectedDate: date, bookingInput: INPUT, ...CAPS });
      record('I2', 'La vista previa tampoco inventa una comisión', iPreview.status === 503, `${iPreview.status}`);
    } finally {
      sql('alter table public.commission_settings disable trigger trg_commission_settings_versioning');
      sql(`insert into public.commission_settings (id, version, ${COLUMNS.join(', ')}, created_at) values (1, ${saved[0]}, ${saved.slice(1, 6).join(', ')}, '${saved[6]}')`);
      sql('alter table public.commission_settings enable trigger trg_commission_settings_versioning');
      sql('alter table public.commission_settings enable trigger trg_commission_settings_no_delete');
    }
    const iAfter = await quoteFor({ token: garser.token, date, hour: hQ, extra: CAPS });
    record('I3', 'Restaurada la configuración, se vuelve a poder presupuestar', iAfter.ok && Boolean(iAfter.body?.quoteId), `${iAfter.status}`);
  } finally {
    cleanup(configBefore);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK`);
  process.exit(failed.length ? 1 : 0);
}

function cleanup(configBefore) {
  try {
    setRates(configBefore);
    if (created.plans.size) {
      sql(`delete from public.maintenance_visits where plan_id in (${ids(created.plans)})`);
      sql(`delete from public.maintenance_plans where id in (${ids(created.plans)})`);
    }
    const quoteBookings = created.quotes.size
      ? sql(`select coalesce(string_agg(id::text, ','), '') from public.bookings where pricing_context->>'quote_id' in (${ids(created.quotes)})`)
      : '';
    quoteBookings.split(',').filter(Boolean).forEach((id) => created.bookings.add(id));
    if (created.bookings.size) {
      for (const id of created.bookings) sql(`select public.release_booking_schedule('${id}')`);
      sql(`delete from public.bookings where id in (${ids(created.bookings)})`);
    }
    if (created.quotes.size) {
      const attemptIds = sql(`select coalesce(string_agg(id::text, ','), '') from public.booking_payment_attempts where quote_id in (${ids(created.quotes)})`);
      attemptIds.split(',').filter(Boolean).forEach((id) => created.attempts.add(id));
    }
    if (created.attempts.size) {
      sql(`delete from public.booking_schedule_hold_blocks where hold_id in (select id from public.booking_schedule_holds where payment_attempt_id in (${ids(created.attempts)}))`);
      sql(`delete from public.booking_schedule_holds where payment_attempt_id in (${ids(created.attempts)})`);
      sql(`delete from public.booking_payment_attempts where id in (${ids(created.attempts)})`);
    }
    if (created.quotes.size) sql(`delete from public.booking_quotes where id in (${ids(created.quotes)})`);
    if (created.users.size) {
      // Las relaciones cliente↔profesional de los usuarios de prueba se borran solas con ellos (ON DELETE CASCADE).
      sql(`delete from auth.users where id in (${ids(created.users)})`);
    }
    console.log(`\nLimpieza hecha: configuración vuelta a ${configBefore.join(' / ')} % (la versión sube: el historial no se borra); ${created.bookings.size} reservas y ${created.quotes.size} presupuestos de prueba borrados.`);
  } catch (error) {
    console.error('Limpieza incompleta:', error.message);
  }
}

main().catch((error) => {
  console.error(error);
  cleanup(readConfig());
  process.exit(1);
});
