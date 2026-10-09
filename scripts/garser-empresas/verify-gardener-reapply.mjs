#!/usr/bin/env node
// Pendientes · fase B: un jardinero rechazado corrige su solicitud y la vuelve a enviar (PH-02).
// Recorrido real: alta → enviar → el admin rechaza (correo) → «Corregir y volver a enviar» → el
// borrador trae sus datos → enviar → el admin ve el rechazo anterior → rechaza otra vez o aprueba.
// Contra el Supabase LOCAL con las funciones servidas.
// Uso: node scripts/garser-empresas/verify-gardener-reapply.mjs

import { accounts, makeRecorder, rest, rpc, runVerification, signIn, sql, why } from './_company-harness.mjs';

const acc = accounts('gardener-reapply.local');
const { results, record } = makeRecorder();
const appOf = (id) => sql(`select status || '|' || coalesce(full_name,'-') || '|' || coalesce(reviewer_id::text,'-') || '|' || coalesce(review_comment,'-')
  || '|' || coalesce(declaration_truth::text,'-') || '|' || coalesce(array_to_string(services, ','),'-') from public.gardener_applications where user_id = '${id}'`);
const historyOf = (id) => sql(`select coalesce(string_agg(coalesce(review_comment,'-'), ',' order by reviewed_at), '') from public.gardener_application_reviews where user_id = '${id}'`);
const outboxOf = (type, id) => sql(`select coalesce(string_agg(status, ',' order by created_at), '') from public.notification_outbox where type = '${type}' and payload->>'user_id' = '${id}'`);
const waitOutbox = async (type, id, n) => {
  for (let i = 0; i < 30; i++) {
    const st = outboxOf(type, id);
    if (st.split(',').filter((x) => x === 'sent').length >= n || /failed/.test(st)) return st;
    await new Promise((r) => setTimeout(r, 700));
  }
  return outboxOf(type, id);
};

/** Alta como la hace la web: borrador con datos y «Enviar». */
async function applyAs(label) {
  const u = await acc.newUser(label, 'gardener');
  const draft = await rest('POST', '/rest/v1/gardener_applications', u.token, {
    user_id: u.id, status: 'draft', full_name: `Jardinero ${label}`, phone: '600123456', city_zone: 'Marbella',
    professional_photo_url: 'https://example.com/foto.jpg', services: ['Corte de césped'], tools_available: ['Cortacésped'],
    experience_years: 4, experience_description: 'Comunidades y chalets', declaration_truth: true, accept_terms: true,
  });
  const sent = await rest('PATCH', `/rest/v1/gardener_applications?user_id=eq.${u.id}`, u.token, { status: 'submitted', submitted_at: new Date().toISOString() });
  return { ...u, appId: draft.rows[0]?.id, sentRows: sent.rows.length };
}
const review = (adminToken, appId, status, comment) =>
  rpc('admin_review_gardener_application', { p_application_id: appId, p_status: status, p_comment: comment }, adminToken);

async function main() {
  const adminToken = await signIn('admin.local@test.local');

  // ── Rechazado → reabrir → borrador con sus datos ───────────────────────────────────────────
  const juan = await applyAs('juan');
  const r1 = await review(adminToken, juan.appId, 'rejected', 'Faltan fotos de trabajos');
  const mail1 = await waitOutbox('gardener_rejected', juan.id, 1);
  const restart = await rpc('restart_gardener_application', {}, juan.token);
  record('GR-01', 'Rechazado (correo enviado) → «Corregir y volver a enviar»: la MISMA solicitud vuelve a borrador con sus datos, sin la revisión y sin las declaraciones; el rechazo queda en el histórico',
    juan.sentRows === 1 && r1.ok && mail1 === 'sent' && restart.ok && restart.body?.applicationId === juan.appId
      && appOf(juan.id) === 'draft|Jardinero juan|-|-|false|Corte de césped' && historyOf(juan.id) === 'Faltan fotos de trabajos',
    `correo [${mail1}], reabrir ${restart.status}${why(restart)}, solicitud [${appOf(juan.id)}], histórico [${historyOf(juan.id)}]`);

  const again = await rpc('restart_gardener_application', {}, juan.token);
  record('GR-02', 'Pulsarlo dos veces (o desde otra pestaña) no duplica el histórico', again.ok && historyOf(juan.id) === 'Faltan fotos de trabajos', `${again.status}`);

  const seen = await rest('GET', `/rest/v1/gardener_application_reviews?user_id=eq.${juan.id}&select=review_comment`, juan.token);
  record('GR-03', 'El jardinero lee el motivo de su rechazo (para corregir)', seen.rows.length === 1 && seen.rows[0].review_comment === 'Faltan fotos de trabajos', `${seen.status} ${JSON.stringify(seen.body).slice(0, 80)}`);

  // ── Corregir y enviar: el admin la ve, con el rechazo anterior ─────────────────────────────
  const fix = await rest('PATCH', `/rest/v1/gardener_applications?user_id=eq.${juan.id}`, juan.token, {
    proof_photos: ['https://example.com/trabajo.jpg'], declaration_truth: true, accept_terms: true,
  });
  const resend = await rest('PATCH', `/rest/v1/gardener_applications?user_id=eq.${juan.id}`, juan.token, { status: 'submitted', submitted_at: new Date().toISOString() });
  const queue = await rest('GET', `/rest/v1/gardener_applications?status=eq.submitted&user_id=eq.${juan.id}&select=id`, adminToken);
  const adminHistory = await rest('GET', `/rest/v1/gardener_application_reviews?application_id=eq.${juan.appId}&select=review_comment`, adminToken);
  record('GR-04', 'Corrige y envía: el admin la tiene en «pendientes» y ve el rechazo anterior',
    fix.rows.length === 1 && resend.rows.length === 1 && queue.rows.length === 1 && adminHistory.rows.length === 1,
    `corregir ${fix.rows.length}, enviar ${resend.rows.length}, cola del admin ${queue.rows.length}, histórico ${adminHistory.rows.length}`);

  // ── Otro rechazo: segundo correo y segundo histórico; después se aprueba ───────────────────
  const r2 = await review(adminToken, juan.appId, 'rejected', 'El teléfono no responde');
  const mail2 = await waitOutbox('gardener_rejected', juan.id, 2);
  await rpc('restart_gardener_application', {}, juan.token);
  await rest('PATCH', `/rest/v1/gardener_applications?user_id=eq.${juan.id}`, juan.token, { declaration_truth: true, accept_terms: true });
  await rest('PATCH', `/rest/v1/gardener_applications?user_id=eq.${juan.id}`, juan.token, { status: 'submitted' });
  const ok = await review(adminToken, juan.appId, 'approved', null);
  const mail3 = await waitOutbox('gardener_approved', juan.id, 1);
  const card = sql(`select coalesce(full_name,'-') from public.gardener_profiles where user_id = '${juan.id}'`);
  record('GR-05', 'Un segundo rechazo manda su correo y se suma al histórico; al final se aprueba: ficha creada y correo de alta',
    r2.ok && mail2 === 'sent,sent' && historyOf(juan.id) === 'Faltan fotos de trabajos,El teléfono no responde' && ok.ok && mail3 === 'sent'
      && card === 'Jardinero juan' && appOf(juan.id).startsWith('approved|'),
    `rechazos [${mail2}], histórico [${historyOf(juan.id)}], aprobar ${ok.status}${why(ok)}, alta [${mail3}], ficha [${card}]`);

  // ── Quién puede ────────────────────────────────────────────────────────────────────────────
  const pending = await applyAs('pendiente');
  const pr = await rpc('restart_gardener_application', {}, pending.token);
  const ar = await rpc('restart_gardener_application', {}, juan.token);
  record('GR-06', 'Con la solicitud pendiente o ya aprobada no se puede «reabrir»: no cambia nada',
    !pr.ok && appOf(pending.id).startsWith('submitted|') && !ar.ok && appOf(juan.id).startsWith('approved|'),
    `pendiente ${pr.status}${why(pr)}, aprobado ${ar.status}${why(ar)}`);

  const ana = await applyAs('ana');
  await review(adminToken, ana.appId, 'rejected', 'Motivo de Ana');
  const intruder = await acc.newUser('intruso', 'gardener');
  const ir = await rpc('restart_gardener_application', {}, intruder.token);
  const peek = await rest('GET', `/rest/v1/gardener_application_reviews?user_id=eq.${juan.id}&select=id`, intruder.token);
  const anon = await rest('POST', '/rest/v1/rpc/restart_gardener_application', null).catch(() => ({ ok: false }));
  record('GR-07', 'Nadie reabre la solicitud de otro (la función solo toca la propia) ni lee su histórico',
    !ir.ok && appOf(ana.id).startsWith('rejected|') && peek.rows.length === 0, `intruso ${ir.status}${why(ir)}, histórico ajeno ${peek.rows.length}, servicio ${anon.status}`);

  // ── Paso 3: los campos de la revisión solo los cambia el servidor ──────────────────────────
  const eve = await acc.newUser('eve', 'gardener');
  await rest('POST', '/rest/v1/gardener_applications', eve.token, { user_id: eve.id, status: 'draft', full_name: 'Eve', review_comment: 'aprobada', reviewer_id: eve.id });
  await rest('PATCH', `/rest/v1/gardener_applications?user_id=eq.${eve.id}`, eve.token, { status: 'submitted', reviewed_at: new Date().toISOString(), review_comment: 'ok', reviewer_id: eve.id });
  const self = await rest('PATCH', `/rest/v1/gardener_applications?user_id=eq.${eve.id}`, eve.token, { status: 'approved' });
  const forge = await rest('POST', '/rest/v1/gardener_application_reviews', eve.token, { application_id: ana.appId, user_id: eve.id, status: 'rejected', review_comment: 'x' });
  record('GR-08', 'El solicitante no puede escribir quién le revisó ni el comentario, ni aprobarse, ni inventarse un histórico',
    appOf(eve.id).startsWith('submitted|Eve|-|-|') && self.rows.length === 0 && !forge.ok,
    `solicitud [${appOf(eve.id)}], aprobarse ${self.rows.length}, histórico falso ${forge.status}`);
}

await runVerification({ acc, results, main });
