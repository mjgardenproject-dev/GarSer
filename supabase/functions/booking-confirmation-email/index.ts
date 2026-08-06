// Supabase Edge Function: emails de reserva pagada (cliente + jardinero)
//
// Se invoca desde booking-payment-webhook (no bloqueante) con { bookingId } o
// { bookingIds: [] } cuando el pago queda confirmado.
//
// El copy depende del ESTADO real de la reserva:
//   - 'pending'  → el pago está hecho pero el jardinero aún debe aceptar:
//                  cliente = "solicitud recibida", jardinero = "nueva solicitud".
//   - 'confirmed' → reserva cerrada: cliente = "reserva confirmada",
//                  jardinero = "nueva reserva confirmada".
//
// Usa la capa de marca compartida (../_shared/emailBrand.ts): plantilla GarSer única,
// nombre real del usuario, CTA a garser.es y versión text/plain.
// Modo MOCK si faltan credenciales SMTP. Nunca lanza por fallos de email.
//
// Secretos: SMTP_USER (remitente verificado en Brevo), SMTP_PASS (api-key),
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_SECRET_KEYS).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  BRAND,
  renderBrandedEmail,
  renderPlainText,
  detailRows,
  sendViaBrevo,
} from '../_shared/emailBrand.ts';
import { buildBookingEmailDetails, GARDENER_AMOUNT_NOTE, type DetailPair } from '../_shared/bookingEmailDetails.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestPayload {
  bookingId?: string;
  bookingIds?: string[];
}

function resolveServiceRoleKey(): string | undefined {
  const modernSecretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (modernSecretKeys) {
    try {
      const parsed = JSON.parse(modernSecretKeys) as Record<string, string>;
      const preferred = parsed.default || Object.values(parsed)[0];
      if (preferred) return preferred;
    } catch {
      // cae al legacy de abajo
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
}

// Esta funcion se despliega con verify_jwt=false para que el webhook pueda invocarla con la
// clave de servicio moderna (sb_secret_..., que NO es un JWT y el gateway rechazaba con 401
// antes de ejecutarla: los emails de reserva no se enviaban nunca y el fallo era invisible).
// Como el gateway ya no filtra, validamos aqui que el llamante presenta una clave de
// servicio valida: sin esto, cualquiera podria disparar emails a terceros conociendo un
// bookingId (vector de spam/phishing con la marca GarSer).
function collectInternalServiceKeys(): string[] {
  const keys: string[] = [];
  const modern = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (modern) {
    try {
      const parsed = JSON.parse(modern) as Record<string, string>;
      Object.values(parsed).forEach((value) => { if (value) keys.push(String(value)); });
    } catch {
      keys.push(modern);
    }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) keys.push(legacy);
  return keys.filter(Boolean);
}

function isInternalServiceCaller(req: Request): boolean {
  const header = String(req.headers.get('Authorization') || req.headers.get('authorization') || '').trim();
  const presented = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : header;
  if (!presented) return false;
  return collectInternalServiceKeys().some((key) => key === presented);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!isInternalServiceCaller(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload = (await req.json()) as RequestPayload;
    const ids = [
      ...(payload.bookingId ? [payload.bookingId] : []),
      ...(Array.isArray(payload.bookingIds) ? payload.bookingIds : []),
    ].map((id) => String(id || '').trim()).filter(Boolean);

    if (ids.length === 0) {
      return new Response(JSON.stringify({ error: 'Falta bookingId o bookingIds.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = resolveServiceRoleKey();
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Faltan secretos de Supabase para booking-confirmation-email.');
    }
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const smtpUser = Deno.env.get('SMTP_USER');
    const smtpPass = Deno.env.get('SMTP_PASS');
    const mock = !smtpUser || !smtpPass;

    const results: Array<Record<string, unknown>> = [];

    for (const bookingId of ids) {
      const details = await buildBookingEmailDetails(admin, bookingId);
      if (!details) {
        results.push({ bookingId, status: 'skipped', reason: 'booking_not_found' });
        continue;
      }

      const { booking, client, gardener, clientPairs, gardenerPairs, clientFeeNote } = details;
      const isPendingAcceptance = booking.status === 'pending';

      // Cada audiencia recibe SU bloque de importes: el cliente ve el total de la reserva y lo
      // que le queda por pagar al profesional; el jardinero, solo lo que va a cobrar.
      const dispatch = async (
        role: 'client' | 'gardener',
        recipient: { email: string | null; name: string },
        subject: string,
        detailPairs: DetailPair[],
        opts: Parameters<typeof renderBrandedEmail>[0],
      ) => {
        if (!recipient.email) {
          results.push({ bookingId, role, status: 'skipped', reason: 'no_email' });
          return;
        }
        if (mock) {
          console.log(`MOCK EMAIL (${role}) -> ${recipient.email} | ${subject}`);
          results.push({ bookingId, role, status: 'mock', to: recipient.email });
          return;
        }
        const sent = await sendViaBrevo({
          to: recipient.email,
          subject,
          html: renderBrandedEmail(opts),
          text: renderPlainText({ ...opts, detailPairs }),
          smtpUser, smtpPass,
        });
        if (!sent.ok) {
          // Sin este log, un rechazo del proveedor (p. ej. Brevo bloqueando la IP del edge
          // runtime, api-key invalida o remitente no verificado) quedaba SOLO dentro del
          // body de la respuesta, que nadie inspecciona: la funcion devolvia 200 y el fallo
          // era invisible en los logs. Cualquier email que no sale tiene que dejar rastro.
          console.error(
            `EMAIL FALLIDO (${role}) -> ${recipient.email} | booking ${bookingId} | ${sent.error || 'sin detalle'}`,
          );
        }
        results.push({
          bookingId, role,
          status: sent.ok ? 'sent' : 'failed',
          to: recipient.email,
          ...(sent.error ? { error: sent.error } : {}),
        });
      };

      if (isPendingAcceptance) {
        await dispatch('client', client, 'Hemos recibido tu reserva en GarSer', clientPairs, {
          title: 'Hemos recibido tu reserva en GarSer',
          heading: `¡Gracias, ${client.name || 'cliente'}!`,
          // El cargo es una AUTORIZACION con captura diferida: hasta que el profesional acepta
          // no se cobra nada. Decir "tu pago esta confirmado" y a la vez "no se te cobrara
          // nada" era contradictorio; ahora se nombra el estado real.
          intro: 'Hemos retenido los gastos de gestión y enviado la solicitud al profesional. Te avisaremos en cuanto la acepte.',
          bodyHtml: detailRows(clientPairs),
          cta: { label: 'Ver mi reserva', url: `${BRAND.site}/bookings` },
          footerNote: clientFeeNote || 'Si el profesional no puede aceptarla, te lo notificaremos y no se te cobrará nada.',
        });
        await dispatch('gardener', gardener, 'Nueva solicitud de reserva en GarSer', gardenerPairs, {
          title: 'Nueva solicitud de reserva en GarSer',
          heading: `Hola ${gardener.name || 'jardinero'}, tienes una nueva solicitud`,
          intro: 'Un cliente ha solicitado una reserva contigo. Revisa el detalle y acéptala o recházala desde tu panel.',
          bodyHtml: detailRows(gardenerPairs),
          cta: { label: 'Revisar solicitud', url: `${BRAND.site}/dashboard` },
          footerNote: `${GARDENER_AMOUNT_NOTE} Las solicitudes sin respuesta caducan automáticamente: responde cuanto antes.`,
        });
      } else {
        await dispatch('client', client, 'Tu reserva en GarSer está confirmada', clientPairs, {
          title: 'Tu reserva en GarSer está confirmada',
          heading: `¡Reserva confirmada, ${client.name || 'cliente'}!`,
          intro: 'Tu reserva ha quedado confirmada. Estos son los detalles:',
          bodyHtml: detailRows(clientPairs),
          cta: { label: 'Ver mi reserva', url: `${BRAND.site}/bookings` },
          footerNote: clientFeeNote || 'El profesional se pondrá en contacto contigo por el chat si necesita algún detalle adicional.',
        });
        await dispatch('gardener', gardener, 'Nueva reserva confirmada en GarSer', gardenerPairs, {
          title: 'Nueva reserva confirmada en GarSer',
          heading: `Nueva reserva, ${gardener.name || 'jardinero'}`,
          intro: 'Tienes una nueva reserva confirmada:',
          bodyHtml: detailRows(gardenerPairs),
          cta: { label: 'Gestionar reserva', url: `${BRAND.site}/dashboard` },
          footerNote: GARDENER_AMOUNT_NOTE,
        });
      }
    }

    return new Response(JSON.stringify({ success: true, mock, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('booking-confirmation-email error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'internal_error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
