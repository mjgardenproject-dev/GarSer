// Supabase Edge Function: Booking confirmation emails (cliente + jardinero)
//
// Envía dos correos transaccionales cuando una reserva queda confirmada/pagada:
//   - Cliente: confirmación de su reserva.
//   - Jardinero: aviso de nueva reserva.
//
// Diseño:
//   - Auto-contenido y testeable: se invoca con { bookingId } o { bookingIds: [] }.
//   - Usa Brevo por API REST (mismo patrón que send-email-notification).
//   - Modo MOCK si faltan credenciales SMTP (no rompe nada, solo loguea).
//   - Nunca lanza por fallos de email: devuelve un resumen por destinatario.
//
// Secretos requeridos (Supabase Secrets):
//   SMTP_USER  -> email remitente verificado en Brevo
//   SMTP_PASS  -> api-key de Brevo
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_SECRET_KEYS)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BRAND_GREEN = '#16a34a';

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

function formatBookingDate(date: string | null, startTime: string | null): string {
  if (!date) return 'Fecha por confirmar';
  try {
    const iso = startTime ? `${date}T${startTime}` : `${date}T00:00:00`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return date;
    const datePart = d.toLocaleDateString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    if (!startTime) return datePart;
    const timePart = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    return `${datePart} a las ${timePart}`;
  } catch {
    return date;
  }
}

function formatPrice(value: number | null | undefined): string {
  const n = Number(value || 0);
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function clientEmailHtml(params: {
  clientName: string; serviceName: string; whenText: string; priceText: string; address: string;
}): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
      <h1 style="color: ${BRAND_GREEN};">¡Reserva confirmada, ${escapeHtml(params.clientName)}!</h1>
      <p>Tu reserva en GarSer ha quedado confirmada. Estos son los detalles:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr><td style="padding: 8px 0; color: #6b7280;">Servicio</td><td style="padding: 8px 0; font-weight: 600;">${escapeHtml(params.serviceName)}</td></tr>
        <tr><td style="padding: 8px 0; color: #6b7280;">Fecha</td><td style="padding: 8px 0; font-weight: 600;">${escapeHtml(params.whenText)}</td></tr>
        <tr><td style="padding: 8px 0; color: #6b7280;">Dirección</td><td style="padding: 8px 0; font-weight: 600;">${escapeHtml(params.address)}</td></tr>
        <tr><td style="padding: 8px 0; color: #6b7280;">Total</td><td style="padding: 8px 0; font-weight: 600;">${escapeHtml(params.priceText)}</td></tr>
      </table>
      <p>El jardinero asignado se pondrá en contacto contigo si necesita algún detalle adicional.</p>
      <p>Gracias por confiar en GarSer.</p>
    </div>
  `;
}

function gardenerEmailHtml(params: {
  gardenerName: string; serviceName: string; whenText: string; priceText: string; address: string;
}): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
      <h1 style="color: ${BRAND_GREEN};">Nueva reserva, ${escapeHtml(params.gardenerName)}</h1>
      <p>Has recibido una nueva reserva confirmada en GarSer:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr><td style="padding: 8px 0; color: #6b7280;">Servicio</td><td style="padding: 8px 0; font-weight: 600;">${escapeHtml(params.serviceName)}</td></tr>
        <tr><td style="padding: 8px 0; color: #6b7280;">Fecha</td><td style="padding: 8px 0; font-weight: 600;">${escapeHtml(params.whenText)}</td></tr>
        <tr><td style="padding: 8px 0; color: #6b7280;">Dirección</td><td style="padding: 8px 0; font-weight: 600;">${escapeHtml(params.address)}</td></tr>
        <tr><td style="padding: 8px 0; color: #6b7280;">Importe</td><td style="padding: 8px 0; font-weight: 600;">${escapeHtml(params.priceText)}</td></tr>
      </table>
      <p>Revisa tu panel de GarSer para gestionar la reserva.</p>
    </div>
  `;
}

async function sendViaBrevo(params: {
  to: string; subject: string; html: string;
  smtpUser: string; smtpPass: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': params.smtpPass,
        'accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'GarSer', email: params.smtpUser },
        to: [{ email: params.to }],
        subject: params.subject,
        htmlContent: params.html,
      }),
    });
    if (!res.ok) {
      const result = await res.json().catch(() => ({}));
      return { ok: false, error: result?.message || `Brevo HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown_brevo_error' };
  }
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
        .select('id, client_id, gardener_id, service_id, date, start_time, total_price, client_address')
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

      const dispatch = async (
        role: 'client' | 'gardener',
        recipient: { email: string | null; name: string },
        subject: string,
        html: string,
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
        const sent = await sendViaBrevo({ to: recipient.email, subject, html, smtpUser, smtpPass });
        results.push({
          bookingId, role,
          status: sent.ok ? 'sent' : 'failed',
          to: recipient.email,
          ...(sent.error ? { error: sent.error } : {}),
        });
      };

      await dispatch(
        'client', client,
        'Tu reserva en GarSer está confirmada',
        clientEmailHtml({
          clientName: client.name || 'cliente',
          serviceName, whenText, priceText, address,
        }),
      );
      await dispatch(
        'gardener', gardener,
        'Nueva reserva confirmada en GarSer',
        gardenerEmailHtml({
          gardenerName: gardener.name || 'jardinero',
          serviceName, whenText, priceText, address,
        }),
      );
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
