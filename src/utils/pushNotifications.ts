// Notificaciones al móvil (prueba real F7, R-08, D25): activarlas en este dispositivo, saber en
// qué estado están y olvidarlas al cerrar sesión (un dispositivo compartido no debe seguir
// recibiendo los avisos de la cuenta anterior).

import { supabase } from '../lib/supabase';
import { VAPID_PUBLIC_KEY } from '../config/push';

export type PushState = 'unsupported' | 'ios-needs-install' | 'denied' | 'enabled' | 'disabled';

export function isIos(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function keyBytes(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((base64url.length + 3) % 4);
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) || null;
}

export async function getPushState(): Promise<PushState> {
  // En iPhone solo funcionan con GarSer añadida a la pantalla de inicio (iOS 16.4 o posterior).
  if (isIos() && !isStandalone()) return 'ios-needs-install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return (await currentSubscription()) ? 'enabled' : 'disabled';
}

/** Pide permiso (tiene que ser tras un toque del usuario) y guarda la suscripción de este dispositivo. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'disabled';
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  const subscription = (await registration.pushManager.getSubscription())
    || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: json.endpoint || '', p_p256dh: json.keys?.p256dh || '', p_auth: json.keys?.auth || '', p_user_agent: navigator.userAgent,
  });
  if (error) {
    await subscription.unsubscribe().catch(() => undefined);
    throw error;
  }
  return 'enabled';
}

/** Deja de recibirlas en este dispositivo. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  await subscription.unsubscribe().catch(() => undefined);
}

/** Al cerrar sesión: este dispositivo deja de recibir los avisos de esa cuenta. Nunca falla. */
export async function forgetThisDevicePush(): Promise<void> {
  try {
    await disablePush();
  } catch {
    /* sin permisos o sin red: la suscripción caducará o pasará a la próxima cuenta que la active */
  }
}
