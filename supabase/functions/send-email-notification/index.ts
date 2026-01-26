// Supabase Edge Function: Send Email Notification via Brevo SMTP
// Requires SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS to be set in Supabase Secrets
// Requires SUPABASE_SERVICE_ROLE_KEY to be set in Supabase Secrets (usually default)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EmailPayload {
  to?: string;
  user_id?: string;
  type: 'gardener_approved' | 'gardener_rejected';
  data: {
    name: string;
    reason?: string;
    loginUrl?: string;
    applyUrl?: string;
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json() as EmailPayload;
    let { to, user_id, type, data } = payload;
    
    const SMTP_HOST = Deno.env.get('SMTP_HOST') || 'smtp-relay.brevo.com';
    const SMTP_PORT = parseInt(Deno.env.get('SMTP_PORT') || '587');
    const SMTP_USER = Deno.env.get('SMTP_USER');
    const SMTP_PASS = Deno.env.get('SMTP_PASS');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    // If 'to' is missing but we have 'user_id', try to fetch email from auth.users
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

    if (!SMTP_USER || !SMTP_PASS) {
      console.log('MOCK EMAIL SEND (Missing SMTP_USER or SMTP_PASS):');
      console.log(`To: ${to}`);
      console.log(`Type: ${type}`);
      console.log('Data:', data);
      return new Response(JSON.stringify({ success: true, mock: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let subject = '';
    let html = '';

    if (type === 'gardener_approved') {
      subject = '¡Bienvenido a GarSer! Tu solicitud ha sido aceptada';
      html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #16a34a;">¡Enhorabuena, ${data.name}!</h1>
          <p>Nos alegra informarte que tu solicitud para unirte a GarSer como jardinero ha sido <strong>aceptada</strong>.</p>
          <p>Estamos encantados de tenerte en nuestro equipo de profesionales. Ahora puedes acceder a tu panel de control para gestionar tu disponibilidad y empezar a recibir reservas.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.loginUrl}" style="background-color: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Iniciar Sesión</a>
          </div>
          <p>Si tienes alguna duda, no dudes en contactarnos.</p>
          <p>¡Bienvenido!</p>
        </div>
      `;
    } else if (type === 'gardener_rejected') {
      subject = 'Actualización sobre tu solicitud en GarSer';
      html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #4b5563;">Estado de tu solicitud</h1>
          <p>Hola ${data.name},</p>
          <p>Gracias por tu interés en unirte a GarSer. Hemos revisado tu solicitud detalladamente.</p>
          <p>Lamentablemente, en este momento no podemos aceptar tu solicitud por el siguiente motivo:</p>
          <div style="background-color: #f3f4f6; padding: 15px; border-left: 4px solid #dc2626; margin: 20px 0;">
            <strong>${data.reason}</strong>
          </div>
          <p>No te desanimes. Este rechazo no es definitivo. Puedes corregir la información o aportar los datos faltantes y volver a enviar tu solicitud.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.applyUrl}" style="background-color: #4b5563; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Volver a solicitar</a>
          </div>
          <p>Esperamos verte pronto.</p>
        </div>
      `;
    } else {
        throw new Error('Invalid email type');
    }

    // Use Brevo API directly to avoid nodemailer dependency issues in Deno Edge Functions
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': SMTP_PASS, // Brevo uses api-key header for API calls, or we can use SMTP protocol but fetch is easier in Deno
        'accept': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'GarSer', email: SMTP_USER }, // Make sure this email is verified in Brevo
        to: [{ email: to }],
        subject: subject,
        htmlContent: html
      }),
    });

    const result = await res.json();
    if (!res.ok) {
        console.error('Brevo API Error:', result);
        throw new Error(result.message || 'Error sending email via Brevo');
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error sending email:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
