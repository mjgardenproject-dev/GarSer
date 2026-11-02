#!/usr/bin/env node
// Consentimiento de publicidad guardado en la solicitud de alta (migración 20261102120000): lo que
// permite mandar «ProviderApproved» a Meta solo por quien aceptó la publicidad al rellenarla.
// Contra el Supabase LOCAL y siempre por la API (como lo haría un atacante), nunca por la interfaz.
//
// Comprueba: que las dos tablas guardan la decisión (las columnas de company_applications se
// conceden una a una), que sin decir nada vale false, que solo se escribe mientras es borrador, que
// el admin la lee y nadie más, y que aprobar sigue funcionando con las columnas nuevas.
//
// Uso:    node scripts/garser-empresas/verify-application-ads-consent.mjs
// Salida: una línea por prueba; código 1 si alguna falla.
// Crea cuentas *@ads-consent.local y lo borra todo al terminar. Solo corre contra 127.0.0.1.

import { accounts, anonKey, apiUrl, makeRecorder, rest, rpc, runVerification, signIn, sql, why } from './_company-harness.mjs';

const acc = accounts('ads-consent.local');
const { results, record } = makeRecorder();

const DECIDED_AT = '2026-11-02T10:15:00.000Z';
const GARDENER_APP = {
  status: 'draft', full_name: 'Jardinero Consent', phone: '600123456', city_zone: 'Marbella',
  professional_photo_url: 'https://example.com/foto.jpg', services: ['Corte de césped'], tools_available: ['Cortacésped'],
  experience_years: 4, experience_description: 'Comunidades y chalets', declaration_truth: true, accept_terms: true,
};
const COMPANY_APP = {
  commercial_name: 'Jardines Consent', legal_name: 'Jardines Consent S.L.', tax_id: 'B12345678',
  contact_name: 'Ana Dueña', phone: '600123123', address: 'Calle Mayor 1, Marbella', city_zone: 'Marbella',
  services: ['Corte de césped'], owner_works: false, accept_terms: true, declaration_truth: true,
  answers: { team_size: '2-5', has_liability_insurance: true },
};

const gardenerRow = (userId) => sql(`select ads_consent::text || '|' || coalesce(to_char(ads_consent_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'), '-') from public.gardener_applications where user_id = '${userId}'`);
const companyRow = (userId) => sql(`select ads_consent::text || '|' || coalesce(to_char(ads_consent_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'), '-') from public.company_applications where user_id = '${userId}'`);

async function main() {
  const adminToken = await signIn('admin.local@test.local');

  // ── Jardinero ───────────────────────────────────────────────────────────────────────────────
  const ana = await acc.newUser('ana', 'gardener');
  const withConsent = await rest('POST', '/rest/v1/gardener_applications', ana.token, {
    user_id: ana.id, ...GARDENER_APP, ads_consent: true, ads_consent_at: DECIDED_AT,
  });
  record('AC-01', 'Jardinero: el borrador guarda que aceptó la publicidad y cuándo lo decidió',
    withConsent.ok && gardenerRow(ana.id) === 'true|2026-11-02T10:15', `${withConsent.status}${why(withConsent)} → [${gardenerRow(ana.id)}]`);

  const luis = await acc.newUser('luis', 'gardener');
  const silent = await rest('POST', '/rest/v1/gardener_applications', luis.token, { user_id: luis.id, ...GARDENER_APP });
  record('AC-02', 'Jardinero: si el formulario no dice nada (o es una solicitud anterior a la migración), vale false y sin fecha',
    silent.ok && gardenerRow(luis.id) === 'false|-', `${silent.status}${why(silent)} → [${gardenerRow(luis.id)}]`);

  const flip = await rest('PATCH', `/rest/v1/gardener_applications?user_id=eq.${ana.id}`, ana.token, { ads_consent: false, ads_consent_at: DECIDED_AT });
  const flipBack = await rest('PATCH', `/rest/v1/gardener_applications?user_id=eq.${ana.id}`, ana.token, { ads_consent: true, ads_consent_at: DECIDED_AT });
  record('AC-03', 'Jardinero: mientras es borrador la decisión se puede cambiar (si acepta o rechaza el banner a mitad del formulario)',
    flip.rows.length === 1 && flipBack.rows.length === 1 && gardenerRow(ana.id) === 'true|2026-11-02T10:15', `${flip.status}/${flipBack.status}`);

  const sentG = await rpc('submit_gardener_application', {}, ana.token);
  const lateG = await rest('PATCH', `/rest/v1/gardener_applications?user_id=eq.${ana.id}`, ana.token, { ads_consent: false });
  record('AC-04', 'Jardinero: una vez enviada ya no se puede tocar (nadie cambia lo que se guardó al enviar)',
    sentG.ok && lateG.rows.length === 0 && gardenerRow(ana.id) === 'true|2026-11-02T10:15', `enviar ${sentG.status}${why(sentG)}, cambiar tras enviar → ${lateG.rows.length} filas`);

  // ── Empresa (permisos por columna) ──────────────────────────────────────────────────────────
  const org = await acc.newUser('org', 'company');
  const draft = await rest('POST', '/rest/v1/company_applications', org.token, {
    user_id: org.id, ...COMPANY_APP, ads_consent: true, ads_consent_at: DECIDED_AT,
  });
  const companyId = draft.rows[0]?.id;
  record('AC-05', 'Empresa: el borrador se crea guardando la decisión (las columnas nuevas están concedidas)',
    draft.ok && companyRow(org.id) === 'true|2026-11-02T10:15', `${draft.status}${why(draft)} → [${companyRow(org.id)}]`);

  const edit = await rest('PATCH', `/rest/v1/company_applications?id=eq.${companyId}`, org.token, { ads_consent: false, ads_consent_at: DECIDED_AT });
  const editBack = await rest('PATCH', `/rest/v1/company_applications?id=eq.${companyId}`, org.token, { ads_consent: true, ads_consent_at: DECIDED_AT });
  record('AC-06', 'Empresa: se puede cambiar mientras es borrador',
    edit.rows.length === 1 && editBack.rows.length === 1 && companyRow(org.id) === 'true|2026-11-02T10:15', `${edit.status}/${editBack.status}${why(edit)}`);

  const selfStatus = await rest('PATCH', `/rest/v1/company_applications?id=eq.${companyId}`, org.token, { status: 'approved', ads_consent: true });
  record('AC-07', 'Empresa: abrir las columnas nuevas no abre el estado (no se puede aprobar a sí misma)',
    !selfStatus.ok && sql(`select status from public.company_applications where id = '${companyId}'`) === 'draft', `${selfStatus.status}${why(selfStatus)}`);

  const sentC = await rpc('submit_company_application', { p_application_id: companyId }, org.token);
  const lateC = await rest('PATCH', `/rest/v1/company_applications?id=eq.${companyId}`, org.token, { ads_consent: false });
  record('AC-08', 'Empresa: una vez enviada ya no se puede tocar',
    sentC.ok && lateC.rows.length === 0 && companyRow(org.id) === 'true|2026-11-02T10:15', `enviar ${sentC.status}${why(sentC)}, cambiar tras enviar → ${lateC.rows.length} filas`);

  // ── Quién lo lee ────────────────────────────────────────────────────────────────────────────
  const adminG = await rest('GET', `/rest/v1/gardener_applications?user_id=eq.${ana.id}&select=id,email,ads_consent,ads_consent_at`, adminToken);
  const adminC = await rest('GET', `/rest/v1/company_applications?id=eq.${companyId}&select=id,ads_consent,ads_consent_at`, adminToken);
  record('AC-09', 'El admin lee la decisión de las dos solicitudes (es lo que mira al aprobar)',
    adminG.rows[0]?.ads_consent === true && adminC.rows[0]?.ads_consent === true, `jardinero ${JSON.stringify(adminG.rows[0]?.ads_consent)}, empresa ${JSON.stringify(adminC.rows[0]?.ads_consent)}`);

  const snoopG = await rest('GET', `/rest/v1/gardener_applications?user_id=eq.${ana.id}&select=ads_consent`, luis.token);
  const snoopC = await rest('GET', `/rest/v1/company_applications?id=eq.${companyId}&select=ads_consent`, luis.token);
  const anon = await fetch(`${apiUrl}/rest/v1/company_applications?id=eq.${companyId}&select=ads_consent`, { headers: { apikey: anonKey } });
  const anonRows = await anon.json();
  record('AC-10', 'Otra persona (ni siquiera con sesión) ni un anónimo leen la decisión de una solicitud ajena',
    snoopG.rows.length === 0 && snoopC.rows.length === 0
      && (anon.status === 401 || anon.status === 403 || (Array.isArray(anonRows) && anonRows.length === 0)),
    `jardinero ajeno ${snoopG.rows.length}, empresa ajena ${snoopC.rows.length}, anónimo ${anon.status}${Array.isArray(anonRows) ? ` (${anonRows.length} filas)` : ' (denegado)'}`);

  // ── Aprobar sigue funcionando con las columnas nuevas ──────────────────────────────────────
  const approveG = await rpc('admin_review_gardener_application', { p_application_id: adminG.rows[0]?.id, p_status: 'approved', p_comment: null }, adminToken);
  const approveC = await rpc('admin_review_company_application', { p_application_id: companyId, p_status: 'approved', p_comment: null }, adminToken);
  record('AC-11', 'Aprobar las dos solicitudes sigue funcionando, y la decisión guardada no se pierde',
    approveG.ok && approveC.ok && gardenerRow(ana.id) === 'true|2026-11-02T10:15' && companyRow(org.id) === 'true|2026-11-02T10:15',
    `jardinero ${approveG.status}${why(approveG)}, empresa ${approveC.status}${why(approveC)}`);
}

await runVerification({ acc, results, main });
