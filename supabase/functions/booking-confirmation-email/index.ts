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
  formatBookingDate,
  formatPrice,
  sendViaBrevo,
} from '../_shared/emailBrand.ts';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
      const { data: booking, error: bookingError } = await admin
        .from('bookings')
        .select('id, client_id, gardener_id, service_id, status, date, start_time, total_price, client_address')
        .eq('id', bookingId)
        .single();

      if (bookingError || !booking) {
        results.push({ bookingId, status: 'skipped', reason: 'booking_not_found' });
        continue;
      }

      // Nombre del servicio
      let serviceName = 'Servicio de jardinería';
      if (booking.service_id) {
        const { data: service } = await admin
          .from('services').select('name').eq('id', booking.service_id).single();
        if (service?.name) serviceName = service.name;
      }

      const whenText = formatBookingDate(booking.date, booking.start_time);
      const priceText = formatPrice(booking.total_price);
      const address = booking.client_address || 'Dirección indicada en la reserva';
      const isPendingAcceptance = booking.status === 'pending';

      // Resolver email + nombre de cliente y jardinero
      const resolveRecipient = async (userId: string | null) => {
        if (!userId) return { email: null as string | null, name: '' };
        let email: string | null = null;
        const { data: userData } = await admin.auth.admin.getUserById(userId);
        if (userData?.user?.email) email = userData.user.email;
        let name = '';
        const { data: profile } = await admin
          .from('profiles').select('full_name').eq('id', userId).single();
        if (profile?.full_name) name = profile.full_name;
        return { email, name };
      };

      const client = await resolveRecipient(booking.client_id);
      const gardener = await resolveRecipient(booking.gardener_id);

      const detailPairs: Array<[string, string]> = [
        ['Servicio', serviceName],
        ['Fecha', whenText],
        ['Dirección', address],
        ['Total', priceText],
      ];

      const dispatch = async (
        role: 'client' | 'gardener',
        recipient: { email: string | null; name: string },
        subject: string,
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
        results.push({
          bookingId, role,
          status: sent.ok ? 'sent' : 'failed',
          to: recipient.email,
          ...(sent.error ? { error: sent.error } : {}),
        });
      };

      if (isPendingAcceptance) {
        await dispatch('client', client, 'Hemos recibido tu reserva en GarSer', {
          title: 'Hemos recibido tu reserva en GarSer',
          heading: `¡Gracias, ${client.name || 'cliente'}!`,
          intro: 'Tu pago está confirmado y hemos enviado la solicitud al profesional. Te avisaremos en cuanto la acepte.',
          bodyHtml: detailRows(detailPairs),
          cta: { label: 'Ver mi reserva', url: `${BRAND.site}/bookings` },
          footerNote: 'Si el profesional no puede aceptarla, te lo notificaremos y no se te cobrará nada.',
        });
        await dispatch('gardener', gardener, 'Nueva solicitud de reserva en GarSer', {
          title: 'Nueva solicitud de reserva en GarSer',
          heading: `Hola ${gardener.name || 'jardinero'}, tienes una nueva solicitud`,
          intro: 'Un cliente ha solicitado una reserva contigo. Revisa el detalle y acéptala o recházala desde tu panel.',
          bodyHtml: detailRows(detailPairs),
          cta: { label: 'Revisar solicitud', url: `${BRAND.site}/dashboard` },
          footerNote: 'Las solicitudes sin respuesta caducan automáticamente: responde cuanto antes.',
        });
      } else {
        await dispatch('client', client, 'Tu reserva en GarSer está confirmada', {
          title: 'Tu reserva en GarSer está confirmada',
          heading: `¡Reserva confirmada, ${client.name || 'cliente'}!`,
          intro: 'Tu reserva ha quedado confirmada. Estos son los detalles:',
          bodyHtml: detailRows(detailPairs),
          cta: { label: 'Ver mi reserva', url: `${BRAND.site}/bookings` },
          footerNote: 'El profesional se pondrá en contacto contigo por el chat si necesita algún detalle adicional.',
        });
        await dispatch('gardener', gardener, 'Nueva reserva confirmada en GarSer', {
          title: 'Nueva reserva confirmada en GarSer',
          heading: `Nueva reserva, ${gardener.name || 'jardinero'}`,
          intro: 'Tienes una nueva reserva confirmada:',
          bodyHtml: detailRows(detailPairs),
          cta: { label: 'Gestionar reserva', url: `${BRAND.site}/dashboard` },
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
