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
//   · booking_review_request                 → al cliente: servicio finalizado, pedimos valoracion
//
// Secretos (Supabase Secrets): SMTP_USER (remitente verificado en Brevo), SMTP_PASS (api-key),
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { BRAND, renderBrandedEmail, renderPlainText, detailRows, sendViaBrevo, escapeHtml, formatBookingDate } from '../_shared/emailBrand.ts';
import { buildBookingEmailDetails, GARDENER_AMOUNT_NOTE } from '../_shared/bookingEmailDetails.ts';
import { isInternalServiceCaller, presentedToken } from '../_shared/functionAuth.ts';

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
  // Al finalizar el servicio: se le pide al cliente su valoracion.
  | 'booking_review_request'
  // Cambio de precio (paso 8B). Hasta ahora este flujo movía dinero sin avisar a nadie: sin
  // notificaciones in-app, el email es el ÚNICO canal, así que el cliente solo se enteraba
  // de que le habían cambiado el precio si entraba por su cuenta al chat o a Mis reservas.
  | 'booking_price_change_proposed'
  | 'booking_price_change_accepted'
  | 'booking_price_change_rejected'
  | 'booking_price_change_expired'
  // Ciclo de cierre: se le pide al cliente que confirme que el trabajo se hizo, y se le avisa
  // de lo que pasa con su incidencia.
  | 'booking_client_confirmation_request'
  | 'booking_incident_received'
  | 'booking_incident_resolved';

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
  'booking_accepted', 'booking_rejected', 'booking_cancelled', 'booking_review_request',
  'booking_price_change_proposed', 'booking_price_change_accepted',
  'booking_price_change_rejected', 'booking_price_change_expired',
  'booking_client_confirmation_request', 'booking_incident_received', 'booking_incident_resolved',
]);

// Quién recibe cada aviso de cambio de precio: la propuesta la sufre el CLIENTE (es quien
// decide), y el desenlace le importa al JARDINERO (es quien lo pidió).
const PRICE_CHANGE_TO_GARDENER = new Set<EmailType>([
  'booking_price_change_accepted', 'booking_price_change_rejected',
]);

/**
 * Enlace de confirmacion de un clic.
 *
 * El token se acuña AQUI, no lo manda el llamante. El contrato de esta funcion prohibe a
 * proposito que nadie inyecte datos libres —era un relay de phishing—, y pasarle una URL
 * desde fuera abriria justo esa puerta. Ademas asi el token en claro no cruza ninguna
 * frontera de red salvo hacia el destinatario, y si Brevo falla no se ha quemado nada.
 *
 * Apunta a la SPA y no a la edge function: los escaneres de enlaces de correo (Outlook Safe
 * Links, antivirus corporativos) hacen GET a todo lo que ven ANTES que el humano, y un GET
 * que muta estado se consumiria solo. La pagina es HTML inerte para el escaner; la redencion
 * real es un POST que dispara React al montar, y los escaneres no ejecutan JavaScript.
 */
// deno-lint-ignore no-explicit-any
async function mintConfirmationUrl(admin: any, bookingId: string, deadlineAt: string | null): Promise<string | null> {
  try {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const token = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hashHex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const expires = deadlineAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error } = await admin.rpc('issue_booking_confirmation_token', {
      p_booking_id: bookingId,
      p_token_hash: `\\x${hashHex}`,
      p_expires_at: expires,
    });
    if (error) {
      console.error('[send-email-notification] no se pudo acuñar el token:', error.message);
      return null;
    }
    return `${BRAND.site}/confirmar-servicio?t=${token}`;
  } catch (error) {
    console.error('[send-email-notification] fallo acuñando el token:', error);
    return null;
  }
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
    let confirmUrl: string | null = null;
    let deadlineAt: string | null = null;

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
      // Una cancelacion la sufre la OTRA parte: si cancela el cliente hay que avisar al
      // jardinero (tiene el hueco reservado), y viceversa. Antes este aviso iba siempre al
      // cliente, de modo que un jardinero podia perder el trabajo sin enterarse.
      const cancelledByClient =
        type === 'booking_cancelled' && details.booking.cancellation_actor === 'client';
      if (PRICE_CHANGE_TO_GARDENER.has(type) || cancelledByClient) {
        // El jardinero propuso el cambio: es a él a quien le importa el desenlace, y ve su
        // propio importe (íntegro), no el total del cliente.
        to = details.gardener.email ?? undefined;
        name = details.gardener.name || 'jardinero';
        counterpartName = details.client.name || '';
        bookingPairs = isPriceChange ? details.priceChangeGardenerPairs : details.gardenerPairs;
        bookingFeeNote = GARDENER_AMOUNT_NOTE;
      } else {
        // El resto informan al cliente de lo que hace el profesional.
        to = details.client.email ?? undefined;
        name = details.client.name || 'cliente';
        counterpartName = details.gardener.name || '';
        bookingPairs = isPriceChange ? details.priceChangeClientPairs : details.clientPairs;
        bookingFeeNote = details.clientFeeNote;
      }

      if (type === 'booking_client_confirmation_request') {
        // Solo un servicio interno puede pedir este correo: lleva dentro un token que confirma
        // el servicio sin sesion, asi que no puede acuñarlo cualquiera que sea parte de la
        // reserva. Es el unico tipo con una restriccion mas estrecha que el resto.
        if (!isInternalServiceCaller(req)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const { data: row } = await admin
          .from('bookings')
          .select('confirmation_deadline_at')
          .eq('id', bookingId)
          .maybeSingle();
        deadlineAt = row?.confirmation_deadline_at ?? null;
        // Si el acuñado falla, el correo sale igual con el enlace a la app: peor que un clic,
        // pero infinitamente mejor que no avisar de que el plazo corre.
        confirmUrl = await mintConfirmationUrl(admin, bookingId, deadlineAt);
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
      // ---- Contrato LEGACY: RETIRADO (paso 9) ----
      // Aceptaba `user_id` + textos libres (`serviceName`, `dateText`, `priceText`) de
      // cualquier usuario autenticado. Como registrarse es gratis y abierto, eso era un relay
      // de phishing: cualquiera podía mandar a cualquier otro usuario un correo con la
      // plantilla y el remitente de GarSer, y con el contenido que quisiera dentro.
      //
      // Existía solo como red durante la ventana de despliegue, para navegadores con la SPA
      // anterior en caché. Ese contrato ya no lo usa nadie del front, y el coste de mantenerlo
      // era dejar la puerta abierta. Ahora falla de forma segura: sin email, en vez de un email
      // que no deberíamos mandar.
      return new Response(JSON.stringify({
        error: 'unsupported_email_type',
        message: 'Tipo de email no soportado. Los avisos de reserva requieren bookingId.',
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
    } else if (type === 'booking_review_request') {
      subject = '¿Qué tal ha ido el servicio?';
      detailPairs = bookingPairs;
      opts = {
        title: subject,
        heading: `Hola ${escapeHtml(name)}`,
        intro: `${escapeHtml(counterpartName || 'El profesional')} ha dado por finalizado el servicio. Tu valoración ayuda a otros clientes a elegir bien, y al profesional a que le encuentren.`,
        bodyHtml: detailPairs.length ? detailRows(detailPairs) : '',
        // Enlace profundo: abre el formulario sobre ESTA reserva en vez de dejar al cliente
        // en la lista buscandola.
        cta: { label: 'Dejar mi valoración', url: `${BRAND.site}/bookings?review=${bookingId}` },
        footerNote: 'Solo te llevará un minuto. Puedes editarla durante las 48 horas siguientes.',
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
    } else if (type === 'booking_client_confirmation_request') {
      // El unico correo del que depende que NO se cobre un servicio no prestado: si el cliente
      // no responde, la reserva se da por completada. Por eso la fecha limite se imprime
      // explicita y sale tal cual de la columna que aplica el reloj, sin recalcularla aqui.
      const deadline = formatBookingDate(
        deadlineAt ? deadlineAt.slice(0, 10) : null,
        deadlineAt ? deadlineAt.slice(11, 19) : null,
      );
      subject = '¿Se hizo el trabajo? Confírmalo, por favor';
      detailPairs = [...bookingPairs, ['Puedes responder hasta', deadline]];
      opts = {
        title: subject,
        heading: `Hola ${escapeHtml(name)}`,
        intro: `¿${escapeHtml(counterpartName || 'El profesional')} hizo el trabajo? Confírmalo y cerramos la reserva.`,
        bodyHtml: detailRows(detailPairs),
        cta: confirmUrl
          ? { label: 'Sí, el trabajo se hizo', url: confirmUrl }
          : { label: 'Confirmar en la app', url: `${BRAND.site}/bookings` },
        secondaryCta: { label: 'Ver la reserva en la app', url: `${BRAND.site}/bookings` },
        footerNote: `Si no nos dices nada antes del ${deadline}, daremos el servicio por completado y los gastos de gestión quedarán cobrados. ¿Algo no fue bien? Abre una incidencia desde la app y lo revisamos.`,
      };
    } else if (type === 'booking_incident_received') {
      subject = 'Hemos recibido tu incidencia';
      detailPairs = bookingPairs;
      opts = {
        title: subject,
        heading: `Hola ${escapeHtml(name)}`,
        intro: 'Hemos recibido lo que nos cuentas y lo estamos revisando. Te escribiremos en cuanto tengamos una respuesta.',
        bodyHtml: detailPairs.length ? detailRows(detailPairs) : '',
        cta: { label: 'Ver mi incidencia', url: `${BRAND.site}/bookings` },
        footerNote: 'Mientras la revisamos, esta reserva no se cerrará ni se cobrará de forma automática.',
      };
    } else if (type === 'booking_incident_resolved') {
      subject = 'Ya hemos revisado tu incidencia';
      detailPairs = bookingPairs;
      opts = {
        title: subject,
        heading: `Hola ${escapeHtml(name)}`,
        intro: 'Hemos terminado de revisar tu incidencia. Puedes ver el detalle y lo que hemos decidido en la app.',
        bodyHtml: detailPairs.length ? detailRows(detailPairs) : '',
        cta: { label: 'Ver el detalle', url: `${BRAND.site}/bookings` },
        footerNote: 'Si hemos devuelto los gastos de gestión, tu banco puede tardar entre 3 y 5 días hábiles en reflejarlo.',
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
