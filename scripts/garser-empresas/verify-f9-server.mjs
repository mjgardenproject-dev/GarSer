#!/usr/bin/env node
// GarSer Empresas · F9.1 — planes de mantenimiento en el SERVIDOR (crear, proponer visitas con el
// planificador, precio fijo, pagar una visita, saltar, cancelar), contra el Supabase LOCAL por los
// caminos reales. El reloj se simula llamando a generate_maintenance_proposals().
//
// Empresa con Ana (césped y setos). Césped 300 m² = 2 h / 54 €.
// Uso: node scripts/garser-empresas/verify-f9-server.mjs

import { randomUUID } from 'node:crypto';
import {
  accounts, createCompany, joinTeam, makeRecorder, rpc, sql, why, authority, pay,
  setAvailability, runVerification, LAWN, HEDGE, LAWN_INPUT,
} from './_company-harness.mjs';
import { execSync } from 'node:child_process';
import { env } from '../readiness/_harness.mjs';

const acc = accounts('f9-server.local');
const { results, record } = makeRecorder();
const day = (n) => sql(`select (current_date + ${n})::text;`).trim();
const generate = () => JSON.parse(sql('select public.generate_maintenance_proposals()::text'));
const HEDGE_INPUT = {
  address: 'Marbella centro', addressCoordinates: { lat: 36.51, lng: -4.882 }, wasteRemoval: false,
  hedgeZones: [{ type: '2-4m', height: '2-4m', length: 40, length_pricing_m: 40, faces_to_trim: 1, state: 'normal' }],
};

async function payQuote(quoteId, client) {
  const prep = await rpc('prepare_booking_payment_attempt_for_client', { p_quote_id: quoteId, p_client_id: client.id, p_hold_ttl_minutes: 15 });
  if (!prep.ok || !prep.body?.attemptId) return { error: `prepare ${prep.status}${why(prep)}` };
  const conf = await rpc('confirm_booking_payment_attempt', {
    p_attempt_id: prep.body.attemptId, p_stripe_event_id: `evt_f9_${randomUUID()}`, p_stripe_payment_intent_id: `pi_f9_${randomUUID()}`,
    p_amount_total_cents: prep.body.payableNowAmountCents, p_currency: 'eur', p_gateway_payload: {},
  });
  return { bookingId: conf.body?.bookingId ?? null, fee: prep.body.payableNowAmountCents, error: conf.body?.bookingId ? null : JSON.stringify(conf.body).slice(0, 200) };
}

async function main() {
  const owner = await createCompany(acc.newUser, 'duena-plan', [LAWN, HEDGE]);
  const ana = await joinTeam(acc.newUser, owner.token, 'ana', [LAWN, HEDGE]);
  const client = await acc.newUser('cliente');
  const stranger = await acc.newUser('otro');
  const accept = (id) => rpc('respond_booking_request', { p_booking_id: id, p_response: 'accept', p_operation_id: randomUUID() }, owner.token);
  const visits = (planId) => sql(`select coalesce(string_agg(planned_date || ':' || status || coalesce('@' || date || ' ' || start_hour, ''), ' | ' order by planned_date), '') from public.maintenance_visits where plan_id = '${planId}'`);

  // Reserva de origen: pasado mañana a las 9.
  setAvailability(ana.id, day(2), [9, 10, 11]);
  const src = await pay(owner.id, client, day(2), 9);
  if (!src.bookingId) throw new Error(`No se pudo crear la reserva de origen: ${src.error || why(src.confirm)}`);
  let plan;
  {
    const early = await rpc('create_maintenance_plan', { p_booking_id: src.bookingId, p_frequency: 'weekly' }, client.token);
    await accept(src.bookingId);
    const byOther = await rpc('create_maintenance_plan', { p_booking_id: src.bookingId, p_frequency: 'weekly' }, stranger.token);
    const bad = await rpc('create_maintenance_plan', { p_booking_id: src.bookingId, p_frequency: 'daily' }, client.token);
    const ok = await rpc('create_maintenance_plan', { p_booking_id: src.bookingId, p_frequency: 'weekly' }, client.token);
    const again = await rpc('create_maintenance_plan', { p_booking_id: src.bookingId, p_frequency: 'monthly' }, client.token);
    plan = ok.body?.planId;
    record('F9-01', 'Solo el cliente, de una reserva confirmada, con frecuencia válida y una vez: plan semanal, próxima visita en 7 días, 54 €',
      !early.ok && !byOther.ok && !bad.ok && ok.ok && !again.ok && ok.body?.nextVisitDate === day(9) && Number(ok.body?.totalPrice) === 54,
      `sin aceptar ${early.status}, otro ${byOther.status}, «daily» ${bad.status}, bien ${ok.status} ${JSON.stringify(ok.body)}, repetido ${again.status}`);
  }
  if (!plan) throw new Error('Sin plan no se puede seguir.');

  let visit1;
  {
    // Faltan 9 días: aún no toca proponer (7 días antes). Se prueba eso y luego se acerca a 7.
    const early = generate();
    sql(`update public.maintenance_plans set next_visit_date = '${day(7)}' where id='${plan}'`);
    setAvailability(ana.id, day(7), [9, 10, 11]);
    const g = generate();
    const row = sql(`select v.id || '|' || v.status || '|' || v.date || '|' || v.start_hour || '|' || q.total_price || '|' || (q.expires_at <= now() + interval '72 hours 1 minute')
      from public.maintenance_visits v join public.booking_quotes q on q.id = v.quote_id where v.plan_id = '${plan}'`);
    visit1 = row.split('|')[0];
    const again = generate();
    record('F9-02', 'El reloj propone la visita 7 días antes (no a 9): a su hora, las 9, 54 €, con 72 h como mucho para confirmar; y no repite propuesta',
      early.proposed === 0 && g.proposed >= 1 && row.endsWith(`|proposed|${day(7)}|9|54|true`) && visits(plan).split('|').length === 1 && again.proposed === 0,
      `a 9 días ${JSON.stringify(early)}; a 7 ${JSON.stringify(g)} → ${row.split('|').slice(1).join(' ')} · otra pasada ${JSON.stringify(again)}`);
  }
  {
    const mine = await rpc('maintenance_visit_checkout', { p_visit_id: visit1 }, client.token);
    const other = await rpc('maintenance_visit_checkout', { p_visit_id: visit1 }, stranger.token);
    const byProvider = await rpc('maintenance_visit_checkout', { p_visit_id: visit1 }, owner.token);
    record('F9-03', 'Los datos para pagar la visita solo se los da al cliente del plan', mine.ok && mine.body?.quoteId && !other.ok && !byProvider.ok,
      `cliente ${mine.status}, otro ${other.status}, empresa ${byProvider.status}`);
  }
  {
    const q = sql(`select quote_id from public.maintenance_visits where id='${visit1}'`);
    const intact = sql(`select public.maintenance_quote_is_intact('${q}')`);
    sql(`update public.booking_quotes set total_price = 10 where id='${q}'`);
    const tampered = sql(`select public.maintenance_quote_is_intact('${q}')`);
    sql(`update public.booking_quotes set total_price = 54 where id='${q}'`);
    record('F9-04', 'El pago reconoce la propuesta intacta y rechaza una alterada (el precio del plan no se recalcula, D19)',
      intact === 't' && tampered === 'f', `intacta ${intact}, alterada ${tampered}`);
  }
  {
    // D19: aunque el profesional cambie su tarifa, las visitas del plan cuestan lo mismo.
    sql(`update public.gardener_service_prices set additional_config = jsonb_set(additional_config, '{precioPorHora}', to_jsonb(99)) where gardener_id='${owner.id}' and service_id='${LAWN}'`);
    const q = sql(`select quote_id from public.maintenance_visits where id='${visit1}'`);
    const r = await payQuote(q, client);
    const b = r.bookingId ? sql(`select total_price || '|' || coalesce(maintenance_plan_id::text, '-') || '|' || (select count(*) from public.booking_items where booking_id = '${r.bookingId}') from public.bookings where id='${r.bookingId}'`) : '';
    record('F9-05', 'Pagar la visita crea una reserva normal de 54 € (aunque la tarifa haya subido), enlazada al plan; la visita queda reservada',
      r.bookingId && b === `54.00|${plan}|1` && sql(`select status from public.maintenance_visits where id='${visit1}'`) === 'booked',
      `${b || r.error} · visita ${sql(`select status from public.maintenance_visits where id='${visit1}'`)}`);
    if (r.bookingId) await accept(r.bookingId);
  }
  {
    // Se adelanta la siguiente para probar: Ana solo libre a las 14 → la hora más cercana.
    sql(`update public.maintenance_plans set next_visit_date = '${day(5)}' where id='${plan}'`);
    setAvailability(ana.id, day(5), [14, 15]);
    generate();
    const row = sql(`select status || '@' || date || ' ' || start_hour from public.maintenance_visits where plan_id='${plan}' and planned_date='${day(5)}'`);
    const next = sql(`select next_visit_date from public.maintenance_plans where id='${plan}'`);
    record('F9-06', 'Si la hora del plan no está libre, propone la más cercana ese día (14:00); el plan avanza una semana',
      row === `proposed@${day(5)} 14` && next === day(12), `${row} · siguiente ${next}`);
  }
  {
    // Caduca sin pagar → se salta; y al no haber hueco en ninguno de los 3 días → «sin hueco».
    sql(`update public.booking_quotes set expires_at = now() - interval '1 minute' where id = (select quote_id from public.maintenance_visits where plan_id='${plan}' and planned_date='${day(5)}')`);
    sql(`update public.maintenance_plans set next_visit_date = '${day(6)}' where id='${plan}'`);
    const g = generate();
    const skipped = sql(`select status from public.maintenance_visits where plan_id='${plan}' and planned_date='${day(5)}'`);
    const none = sql(`select status from public.maintenance_visits where plan_id='${plan}' and planned_date='${day(6)}'`);
    record('F9-07', 'Una propuesta que caduca sin pagar se salta (D17); sin hueco en 3 días, la visita queda «sin hueco» y el plan sigue',
      skipped === 'skipped' && none === 'no_availability' && g.skipped >= 1 && sql(`select status from public.maintenance_plans where id='${plan}'`) === 'active',
      `${JSON.stringify(g)} · día 5 ${skipped}, día 6 ${none}`);
  }
  {
    // F9.2: avisos. Lo mismo que hace el reloj (claim + correo), sin el resto de sus trabajos
    // (uno de ellos habla con Stripe).
    const { apiUrl, serviceRoleKey, anonKey } = env();
    const since = new Date().toISOString();
    const claimed = sql(`select coalesce(string_agg(visit_id || ':' || email_type, ','), '') from public.claim_maintenance_notifications(50) c
      where visit_id in (select id from public.maintenance_visits where plan_id='${plan}')`);
    const mail = async (key, body) => {
      const res = await fetch(`${apiUrl}/functions/v1/send-email-notification`, {
        method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    const results2 = [];
    for (const item of claimed.split(',').filter(Boolean)) {
      const [visitId, type] = item.split(':');
      results2.push({ type, r: await mail(serviceRoleKey, { type, visitId }) });
    }
    const byClient = await mail(client.token, { type: 'maintenance_visit_proposed', visitId: claimed.split(':')[0] });
    const again = sql(`select count(*) from public.claim_maintenance_notifications(50) c where visit_id in (select id from public.maintenance_visits where plan_id='${plan}')`);
    const logs = execSync(`docker logs --since ${since} supabase_edge_runtime_GarSer-main_4 2>&1`).toString();
    const types = results2.map((x) => x.type).sort().join(',');
    record('F9-12', 'Avisos: la propuesta («Tu próxima visita: …») y «esta vez no hay hueco» salen una vez, solo a petición del servidor',
      types.includes('maintenance_visit_unavailable') && results2.every((x) => x.r.status === 200) && byClient.status === 403 && again === '0' &&
      logs.includes('Esta vez no hay hueco para tu visita de mantenimiento'),
      `${results2.map((x) => `${x.type}:${x.r.status}`).join(', ')}, cliente ${byClient.status}, segunda pasada ${again}`);
  }
  {
    const cp = await rpc('my_maintenance_plans', {}, client.token);
    const pp = await rpc('my_maintenance_plans', {}, owner.token);
    const op = await rpc('my_maintenance_plans', {}, stranger.token);
    const c = (cp.body || [])[0] || {};
    record('F9-08', 'Cliente y empresa ven el plan (servicios, frecuencia, precio, visitas); otro no ve nada',
      c.frequency === 'weekly' && c.services === 'Corte de césped' && Number(c.total_price) === 54 && c.role === 'client' && (c.visits || []).length >= 3 &&
      (pp.body || [])[0]?.role === 'provider' && (op.body || []).length === 0,
      `cliente ${c.role}/${c.services}/${c.frequency}/${(c.visits || []).length} visitas, empresa ${(pp.body || [])[0]?.role}, otro ${(op.body || []).length}`);
  }
  {
    sql(`update public.maintenance_plans set next_visit_date = '${day(3)}' where id='${plan}'`);
    setAvailability(ana.id, day(3), [9, 10, 11]);
    generate();
    const open = sql(`select id from public.maintenance_visits where plan_id='${plan}' and status='proposed'`);
    const byOther = await rpc('cancel_maintenance_plan', { p_plan_id: plan }, stranger.token);
    const cancel = await rpc('cancel_maintenance_plan', { p_plan_id: plan }, owner.token);
    const checkout = await rpc('maintenance_visit_checkout', { p_visit_id: open }, client.token);
    const quoteStatus = sql(`select q.status from public.booking_quotes q join public.maintenance_visits v on v.quote_id = q.id where v.id='${open}'`);
    const g = generate();
    record('F9-09', 'La empresa (o el cliente) cancela el plan: la propuesta abierta deja de valer y no se proponen más',
      Boolean(open) && !byOther.ok && cancel.ok && !checkout.ok && quoteStatus === 'expired' && g.proposed === 0 &&
      sql(`select status from public.maintenance_visits where id='${open}'`) === 'cancelled',
      `otro ${byOther.status}, empresa ${cancel.status}, pagar ${checkout.status}, presupuesto ${quoteStatus}, nueva pasada ${JSON.stringify(g)}`);
  }
  {
    // Nunca para mañana: no daría un día de margen para confirmar.
    sql(`update public.maintenance_plans set status = 'active', next_visit_date = '${day(1)}' where id='${plan}'`);
    setAvailability(ana.id, day(1), [9, 10, 11]);
    generate();
    const row = sql(`select coalesce(string_agg(status || '@' || coalesce(date::text, '-'), ','), '') from public.maintenance_visits where plan_id='${plan}' and planned_date='${day(1)}'`);
    record('F9-11', 'Una visita que tocaría mañana se propone como pronto pasado mañana (hay un día para confirmar)',
      row === '' || !row.includes(`@${day(1)}`), row || 'no se propone para mañana');
    // Y su aviso: «Tu próxima visita: Corte de césped, …».
    const { apiUrl, serviceRoleKey, anonKey } = env();
    const since = new Date().toISOString();
    const claimed = sql(`select coalesce(string_agg(visit_id || ':' || email_type, ','), '') from public.claim_maintenance_notifications(50) c
      where visit_id in (select id from public.maintenance_visits where plan_id='${plan}')`);
    const [visitId, type] = claimed.split(',')[0].split(':');
    const res = await fetch(`${apiUrl}/functions/v1/send-email-notification`, {
      method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, visitId }),
    });
    const logs = execSync(`docker logs --since ${since} supabase_edge_runtime_GarSer-main_4 2>&1`).toString();
    record('F9-13', 'El aviso de la propuesta llega al cliente: «Tu próxima visita: Corte de césped, …»',
      type === 'maintenance_visit_proposed' && res.status === 200 && logs.includes('Tu próxima visita: Corte de césped'), `${type} ${res.status}`);
    sql(`update public.maintenance_plans set status = 'cancelled' where id='${plan}'`);
  }
  {
    // Plan de varios servicios (F8): la visita lleva los dos.
    setAvailability(ana.id, day(4), [8, 9, 10, 11, 12, 13]);
    const q = await authority({ action: 'create_quote', serviceId: LAWN, providerId: owner.id, date: day(4), startTime: '08:00', bookingInput: LAWN_INPUT,
      items: [{ serviceId: LAWN, bookingInput: LAWN_INPUT }, { serviceId: HEDGE, bookingInput: HEDGE_INPUT }] }, { accessToken: client.token });
    const src2 = q.body?.quoteId ? await payQuote(q.body.quoteId, client) : { error: why(q) };
    if (src2.bookingId) await accept(src2.bookingId);
    const p2 = src2.bookingId ? await rpc('create_maintenance_plan', { p_booking_id: src2.bookingId, p_frequency: 'biweekly' }, client.token) : null;
    const plan2 = p2?.body?.planId;
    setAvailability(ana.id, day(3), [8, 9, 10, 11, 12, 13]);
    if (plan2) { sql(`update public.maintenance_plans set next_visit_date = '${day(3)}' where id='${plan2}'`); generate(); }
    const v2 = plan2 ? sql(`select quote_id from public.maintenance_visits where plan_id='${plan2}' and status='proposed'`) : '';
    const r = v2 ? await payQuote(v2, client) : { error: 'sin propuesta' };
    const its = r.bookingId ? sql(`select string_agg(s.name, ' + ' order by position) from public.booking_items i join public.services s on s.id=i.service_id where booking_id='${r.bookingId}'`) : '';
    record('F9-10', 'Plan quincenal de césped + setos: la visita se reserva con los dos servicios y el precio del plan',
      Boolean(plan2) && its === 'Corte de césped + Poda de setos' && sql(`select total_price from public.bookings where id='${r.bookingId}'`) === sql(`select total_price::numeric(10,2)::text from public.maintenance_plans where id='${plan2}'`),
      `${plan2 ? 'plan' : `sin plan ${why(p2 || {})}`} · ${its || r.error}`);
  }
}

await runVerification({ acc, results, main });
