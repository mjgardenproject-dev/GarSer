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
import { buildBookingEmailDetails, GARDENER_AMOUNT_NOTE } from '../_shared/bookingEmailDetails.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type EmailType =
  | 'gardener_approved'
  | 'gardener_rejected'
  | 'booking_accepted'
  | 'booking_rejected'
  | 'booking_cancelled'
  // Cambio de precio (paso 8B). Hasta ahora este flujo movía dinero sin avisar a nadie: sin
  // notificaciones in-app, el email es el ÚNICO canal, así que el cliente solo se enteraba
  // de que le habían cambiado el precio si entraba por su cuenta al chat o a Mis reservas.
  | 'booking_price_change_proposed'
  | 'booking_price_change_accepted'
  | 'booking_price_change_rejected'
  | 'booking_price_change_expired';

interface EmailPayload {
  /**
   * NO se acepta un destinatario libre: se ignora si llega. El email se resuelve siempre
   * desde `bookingId` o `user_id` con la clave de servicio. Aceptarlo permitía usar esta
   * función como relay para mandar correos con la marca GarSer a cualquier dirección.
   */
  user_id?: string;
  type: EmailType;
  /**
   * Contrato vigente para los tipos de reserva: solo el id. Los importes, el nombre del
   * servicio, la fecha y los nombres de las partes se resuelven en el servidor.
   * Antes el navegador enviaba `priceText` ya formateado, es decir: un dato de dinero
   * compuesto en un cliente no confiable, con un formato de euro distinto al del resto.
   */
  bookingId?: string;
  data?: {
    name?: string;
    reason?: string;
    loginUrl?: string;
    applyUrl?: string;
    // Campos del contrato LEGACY (ver nota de compatibilidad en el handler).
    counterpartName?: string;
    serviceName?: string;
    dateText?: string;
    priceText?: string;
  };
}

const BOOKING_EMAIL_TYPES = new Set<EmailType>([
  'booking_accepted', 'booking_rejected', 'booking_cancelled',
  'booking_price_change_proposed', 'booking_price_change_accepted',
  'booking_price_change_rejected', 'booking_price_change_expired',
]);

// Quién recibe cada aviso de cambio de precio: la propuesta la sufre el CLIENTE (es quien
// decide), y el desenlace le importa al JARDINERO (es quien lo pidió).
const PRICE_CHANGE_TO_GARDENER = new Set<EmailType>([
  'booking_price_change_accepted', 'booking_price_change_rejected',
]);

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

function presentedToken(req: Request): string {
  const header = String(req.headers.get('Authorization') || req.headers.get('authorization') || '').trim();
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : header;
}

function isInternalServiceCaller(req: Request): boolean {
  const token = presentedToken(req);
  if (!token) return false;
  return collectInternalServiceKeys().some((key) => key === token);
}

/**
 * Los avisos de alta/rechazo de jardinero solo los puede disparar un administrador.
 * `profiles` se consulta por `id` y por `user_id`: el histórico de migraciones usa ambas
 * como clave contra auth.uid(), y aquí no podemos asumir cuál rige.
 */
// deno-lint-ignore no-explicit-any
async function isAdminCaller(req: Request, admin: any): Promise<boolean> {
  const token = presentedToken(req);
  if (!token) return false;
  const { data: caller } = await admin.auth.getUser(token);
  const callerId = caller?.user?.id;
  if (!callerId) return false;
  const { data: rows } = await admin
    .from('profiles')
    .select('role')
    .or(`id.eq.${callerId},user_id.eq.${callerId}`)
    .limit(5);
  // deno-lint-ignore no-explicit-any
  return Array.isArray(rows) && rows.some((row: any) => String(row?.role || '') === 'admin');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as EmailPayload;
    let to: string | undefined;
    const { user_id, type, data } = payload;
    const bookingId = String(payload.bookingId || '').trim();

    const SMTP_USER = Deno.env.get('SMTP_USER');
    const SMTP_PASS = Deno.env.get('SMTP_PASS');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const admin =
      SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

    let name = data?.name || 'cliente';
    let counterpartName = data?.counterpartName || '';
    let bookingPairs: Array<[string, string]> = [];
    let bookingFeeNote = '';

    if (BOOKING_EMAIL_TYPES.has(type) && bookingId) {
      // ---- Contrato vigente: todo se resuelve aquí, con la clave de servicio ----
      if (!admin) {
        throw new Error('Faltan secretos de Supabase para resolver la reserva.');
      }

      const details = await buildBookingEmailDetails(admin, bookingId);
      if (!details) {
        return new Response(JSON.stringify({ error: 'booking_not_found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Autorización: o llama un servicio interno, o llama un usuario que es parte de ESTA
      // reserva. Sin esta comprobación cualquier usuario autenticado podía disparar correos
      // con la marca GarSer a cualquier dirección: un relay de phishing.
      if (!isInternalServiceCaller(req)) {
        const token = presentedToken(req);
        const { data: caller } = token ? await admin.auth.getUser(token) : { data: null };
        const callerId = caller?.user?.id || '';
        const isParticipant =
          callerId &&
          (callerId === details.booking.client_id || callerId === details.booking.gardener_id);
        if (!isParticipant) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      const isPriceChange = type.startsWith('booking_price_change');
      if (PRICE_CHANGE_TO_GARDENER.has(type)) {
        // El jardinero propuso el cambio: es a él a quien le importa el desenlace, y ve su
        // propio importe (íntegro), no el total del cliente.
        to = details.gardener.email;
        name = details.gardener.name || 'jardinero';
        counterpartName = details.client.name || '';
        bookingPairs = isPriceChange ? details.priceChangeGardenerPairs : details.gardenerPairs;
        bookingFeeNote = GARDENER_AMOUNT_NOTE;
      } else {
        // El resto informan al cliente de lo que hace el profesional.
        to = details.client.email;
        name = details.client.name || 'cliente';
        counterpartName = details.gardener.name || '';
        bookingPairs = isPriceChange ? details.priceChangeClientPairs : details.clientPairs;
        bookingFeeNote = details.clientFeeNote;
      }
    } else if (type === 'gardener_approved' || type === 'gardener_rejected') {
      // Avisos de alta/rechazo de jardinero: solo administradores (o un servicio interno).
      if (!admin) {
        throw new Error('Faltan secretos de Supabase para autorizar la llamada.');
      }
      if (!isInternalServiceCaller(req) && !(await isAdminCaller(req, admin))) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (user_id) {
        const { data: userData, error: userError } = await admin.auth.admin.getUserById(user_id);
        if (!userError && userData?.user?.email) {
          to = userData.user.email;
        } else {
          console.error('Error fetching user email:', userError);
        }
      }
    } else {
      // ---- Contrato LEGACY de reserva (navegadores con la SPA anterior en caché) ----
      // Se mantiene solo durante la ventana de despliegue; se retira en el paso siguiente,
      // momento en el que estas tres ramas exigirán bookingId como el resto.
      if (!admin) {
        throw new Error('Faltan secretos de Supabase para autorizar la llamada.');
      }
      if (!isInternalServiceCaller(req)) {
        const token = presentedToken(req);
        const { data: caller } = token ? await admin.auth.getUser(token) : { data: null };
        if (!caller?.user?.id) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
      if (user_id && admin) {
        const { data: userData, error: userError } = await admin.auth.admin.getUserById(user_id);
        if (!userError && userData?.user?.email) {
          to = userData.user.email;
        } else {
          console.error('Error fetching user email:', userError);
        }
      }

      if (data?.serviceName) bookingPairs.push(['Servicio', data.serviceName]);
      if (data?.dateText) bookingPairs.push(['Fecha', data.dateText]);
      if (data?.priceText) bookingPairs.push(['Precio del servicio', data.priceText]);
    }

    if (!to) {
      throw new Error('Recipient email (to) is required or could not be found via user_id');
    }

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
        cta: { label: 'Volver a solicitar', url: data?.applyUrl || `${BRAND.site}/apply` },
        footerNote: 'Este rechazo no es definitivo: puedes corregir la información y volver a enviar tu solicitud.',
      };
    } else if (type === 'booking_accepted') {
      subject = '¡Tu reserva en GarSer ha sido aceptada!';
      detailPairs = bookingPairs;
      opts = {
        title: subject,
        heading: `¡Buenas noticias, ${escapeHtml(name)}!`,
        intro: `${escapeHtml(counterpartName || 'El profesional')} ha aceptado tu reserva. Todo listo:`,
        bodyHtml: detailPairs.length ? detailRows(detailPairs) : '',
        cta: { label: 'Ver mi reserva', url: `${BRAND.site}/bookings` },
        footerNote: bookingFeeNote || 'Puedes hablar con el profesional desde el chat de la reserva.',
      };
    } else if (type === 'booking_rejected') {
      subject = 'Tu solicitud de reserva no ha podido ser aceptada';
      detailPairs = bookingPairs;
      opts = {
        title: subject,
        heading: `Hola ${escapeHtml(name)}`,
        intro: `${escapeHtml(counterpartName || 'El profesional')} no ha podido aceptar tu solicitud de reserva. No se te cobrará nada.`,
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
        footerNote: data?.reason ? `Motivo: ${data.reason}` : bookingFeeNote,
      };
    } else if (type === 'booking_price_change_proposed') {
      subject = 'El profesional propone un nuevo precio para tu reserva';
      detailPairs = bookingPairs;
      opts = {
        title: subject,
        heading: `Hola ${escapeHtml(name)}`,
        intro: `${escapeHtml(counterpartName || 'El profesional')} ha propuesto un nuevo precio para tu reserva. Revísalo y decide si lo aceptas; hasta entonces la reserva mantiene el precio actual.`,
        bodyHtml: detailPairs.length ? detailRows(detailPairs) : '',
        cta: { label: 'Revisar la propuesta', url: `${BRAND.site}/bookings` },
        footerNote: 'Los gastos de gestión que ya abonaste no cambian. Si no respondes, la propuesta caduca y la reserva sigue con el precio original.',
      };
    } else if (type === 'booking_price_change_accepted') {
      subject = 'El cliente ha aceptado tu nuevo precio';
      detailPairs = bookingPairs;
      opts = {
        title: subject,
        heading: `Buenas noticias, ${escapeHtml(name)}`,
        intro: `${escapeHtml(counterpartName || 'El cliente')} ha aceptado el nuevo precio. La reserva queda confirmada con el importe actualizado:`,
        bodyHtml: detailPairs.length ? detailRows(detailPairs) : '',
        cta: { label: 'Ver la reserva', url: `${BRAND.site}/bookings` },
        footerNote: bookingFeeNote,
      };
    } else if (type === 'booking_price_change_rejected') {
      subject = 'El cliente no ha aceptado el cambio de precio';
      detailPairs = bookingPairs;
      opts = {
        title: subject,
        heading: `Hola ${escapeHtml(name)}`,
        intro: `${escapeHtml(counterpartName || 'El cliente')} no ha aceptado el nuevo precio. La reserva continúa con el precio original:`,
        bodyHtml: detailPairs.length ? detailRows(detailPairs) : '',
        cta: { label: 'Ver la reserva', url: `${BRAND.site}/bookings` },
        footerNote: 'Puedes hablarlo con el cliente por el chat de la reserva.',
      };
    } else if (type === 'booking_price_change_expired') {
      subject = 'La propuesta de cambio de precio ha caducado';
      detailPairs = bookingPairs;
      opts = {
        title: subject,
        heading: `Hola ${escapeHtml(name)}`,
        intro: 'La propuesta de cambio de precio ha caducado sin respuesta. La reserva mantiene su precio original:',
        bodyHtml: detailPairs.length ? detailRows(detailPairs) : '',
        cta: { label: 'Ver la reserva', url: `${BRAND.site}/bookings` },
        footerNote: 'Si sigue siendo necesario ajustar el precio, podéis acordarlo por el chat.',
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
