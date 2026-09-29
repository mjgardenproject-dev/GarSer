// Prueba real · F7 (R-08, D25): cada correo sale también como notificación al móvil a los
// dispositivos en los que el destinatario la ha activado. Nunca rompe el envío del correo: si no
// hay claves VAPID configuradas, si falla o si no tiene dispositivos, no pasa nada.

import { pushMessageFromEmail, sendWebPush, type PushMessage } from './webPush.ts';

// deno-lint-ignore no-explicit-any
type AdminClient = any;

function vapidKeys() {
  const publicKey = String(Deno.env.get('VAPID_PUBLIC_KEY') || '').trim();
  const privateKey = String(Deno.env.get('VAPID_PRIVATE_KEY') || '').trim();
  const subject = String(Deno.env.get('VAPID_SUBJECT') || 'mailto:info@garser.es').trim();
  return publicKey && privateKey ? { publicKey, privateKey, subject } : null;
}

export async function pushToEmail(admin: AdminClient, email: string | null | undefined, message: PushMessage): Promise<number> {
  const keys = vapidKeys();
  if (!keys || !admin || !email) return 0;
  try {
    const { data: subs } = await admin.rpc('push_subscriptions_for_email', { p_email: email });
    let delivered = 0;
    for (const sub of (subs || []) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>) {
      try {
        const result = await sendWebPush(sub, message, keys);
        if (result.gone) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id);
        } else if (result.ok) {
          delivered += 1;
          await admin.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', sub.id);
        } else {
          console.warn('[push] el servicio de push respondió', result.status);
        }
      } catch (error) {
        console.warn('[push] fallo enviando a un dispositivo:', error instanceof Error ? error.message : error);
      }
    }
    return delivered;
  } catch (error) {
    console.warn('[push] fallo buscando dispositivos:', error instanceof Error ? error.message : error);
    return 0;
  }
}

/** Atajo: la notificación que corresponde a un correo (asunto, entradilla y botón). */
export function pushForEmail(admin: AdminClient, email: string | null | undefined, subject: string, intro: string, url?: string) {
  return pushToEmail(admin, email, pushMessageFromEmail(subject, intro, url || 'https://garser.es/'));
}
