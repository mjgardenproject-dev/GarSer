// Supabase Edge Function: punto único de emails transaccionales por tipo.
// Usa la capa de marca compartida (../_shared/emailBrand.ts) → plantilla GarSer única,
// nombre real del usuario, CTA a garser.es y versión text/plain. Envío vía Brevo,
// con modo MOCK si faltan credenciales SMTP.
//
// Tipos soportados:
//   · gardener_approved / gardener_rejected  → estado de la solicitud de jardinero
//   · booking_accepted                       → al cliente: el jardinero aceptó su reserva
//   · booking_rejected                       → al cliente: la solicitud no fue aceptada
//   · booking_cancelled                      → a cualquiera de las partes: reserva cancelada
//
// Secretos (Supabase Secrets): SMTP_USER (remitente verificado en Brevo), SMTP_PASS (api-key),
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { BRAND, renderBrandedEmail, renderPlainText, detailRows, sendViaBrevo, escapeHtml } from '../_shared/emailBrand.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type EmailType =
  | 'gardener_approved'
  | 'gardener_rejected'
  | 'booking_accepted'
  | 'booking_rejected'
  | 'booking_cancelled';

interface EmailPayload {
  to?: string;
  user_id?: string;
  type: EmailType;
  data: {
    name: string;
    reason?: string;
    loginUrl?: string;
    applyUrl?: string;
    // Tipos de reserva
    counterpartName?: string;
    serviceName?: string;
    dateText?: string;
    priceText?: string;
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as EmailPayload;
    let { to } = payload;
    const { user_id, type, data } = payload;

    const SMTP_USER = Deno.env.get('SMTP_USER');
    const SMTP_PASS = Deno.env.get('SMTP_PASS');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    // Resolver el email a partir del user_id si no se envía 'to'
    if (!to && user_id && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(user_id);
      if (!userError && userData?.user?.email) {
        to = userData.user.email;
      } else {
        console.error('Error fetching user email:', userError);
      }
    }

    if (!to) {
      throw new Error('Recipient email (to) is required or could not be found via user_id');
    }

    const name = data?.name || 'cliente';
    // Filas de detalle de reserva (solo las que vengan informadas)
    const bookingPairs: Array<[string, string]> = [];
    if (data?.serviceName) bookingPairs.push(['Servicio', data.serviceName]);
    if (data?.dateText) bookingPairs.push(['Fecha', data.dateText]);
    if (data?.priceText) bookingPairs.push(['Total', data.priceText]);

    let subject = '';
    let opts: Parameters<typeof renderBrandedEmail>[0];
    let detailPairs: Array<[string, string]> = [];

    if (type === 'gardener_approved') {
      subject = '¡Bienvenido a GarSer! Tu solicitud ha sido aceptada';
      opts = {
        title: subject,
        heading: `¡Enhorabuena, ${escapeHtml(name)}!`,
        intro: 'Tu solicitud para unirte a GarSer como jardinero ha sido aceptada. Ya puedes acceder a tu panel para configurar tus precios y tu disponibilidad y empezar a recibir reservas.',
        cta: { label: 'Acceder a mi panel', url: data?.loginUrl || `${BRAND.site}/dashboard` },
        footerNote: 'Si tienes cualquier duda, responde a este correo y te ayudamos.',
      };
    } else if (type === 'gardener_rejected') {
      subject = 'Actualización sobre tu solicitud en GarSer';
      detailPairs = data?.reason ? [['Motivo', data.reason]] : [];
      opts = {
        title: subject,
        heading: `Hola ${escapeHtml(name)}`,
        intro: 'Gracias por tu interés en unirte a GarSer. Hemos revisado tu solicitud y por ahora no podemos aceptarla por el siguiente motivo:',
        bodyHtml: detailPairs.length ? detailRows(detailPairs) : '',
        cta: { label: 'Volver a solicitar', url: data?.applyUrl || `${BRAND.site}/aplicar` },
        footerNote: 'Este rechazo no es definitivo: puedes corregir la información y volver a enviar tu solicitud.',
      };
    } else if (type === 'booking_accepted') {
      subject = '¡Tu reserva en GarSer ha sido aceptada!';
      detailPairs = bookingPairs;
      opts = {
        title: subject,
        heading: `¡Buenas noticias, ${escapeHtml(name)}!`,
        intro: `${escapeHtml(data?.counterpartName || 'El profesional')} ha aceptado tu reserva. Todo listo:`,
        bodyHtml: detailPairs.length ? detailRows(detailPairs) : '',
        cta: { label: 'Ver mi reserva', url: `${BRAND.site}/bookings` },
        footerNote: 'Puedes hablar con el profesional desde el chat de la reserva.',
      };
    } else if (type === 'booking_rejected') {
      subject = 'Tu solicitud de reserva no ha podido ser aceptada';
      detailPairs = bookingPairs;
      opts = {
        title: subject,
        heading: `Hola ${escapeHtml(name)}`,
        intro: `${escapeHtml(data?.counterpartName || 'El profesional')} no ha podido aceptar tu solicitud de reserva. No se te cobrará nada.`,
        bodyHtml: detailPairs.length ? detailRows(detailPairs) : '',
        cta: { label: 'Buscar otro profesional', url: `${BRAND.site}/reserva` },
        footerNote: 'Hay más jardineros disponibles en tu zona: puedes repetir la reserva en un minuto.',
      };
    } else if (type === 'booking_cancelled') {
      subject = 'Reserva cancelada en GarSer';
      detailPairs = bookingPairs;
      opts = {
        title: subject,
        heading: `Hola ${escapeHtml(name)}`,
        intro: 'Te confirmamos que la siguiente reserva ha quedado cancelada:',
        bodyHtml: detailPairs.length ? detailRows(detailPairs) : '',
        cta: { label: 'Ver mis reservas', url: `${BRAND.site}/bookings` },
        ...(data?.reason ? { footerNote: `Motivo: ${data.reason}` } : {}),
      };
    } else {
      throw new Error('Invalid email type');
    }

    const html = renderBrandedEmail(opts);
    const text = renderPlainText({ ...opts, detailPairs });

    if (!SMTP_USER || !SMTP_PASS) {
      console.log('MOCK EMAIL SEND (faltan SMTP_USER/SMTP_PASS):', { to, type, subject });
      return new Response(JSON.stringify({ success: true, mock: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sent = await sendViaBrevo({ to, subject, html, text, smtpUser: SMTP_USER, smtpPass: SMTP_PASS });
    if (!sent.ok) {
      throw new Error(sent.error || 'Error sending email via Brevo');
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error sending email:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'unknown' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
