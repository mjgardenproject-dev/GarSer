// Construcción del evento para el Conversions API de Meta, separada de index.ts para poder probarla
// sin Deno (mismo patrón que booking-payment/error-classification.ts).

export interface CapiPayload {
  event_name: string;
  event_id: string;
  event_source_url?: string;
  user_data?: { email?: string; phone?: string };
  custom_data?: Record<string, unknown>;
  /** 'visitor' (por defecto): el evento sale del navegador de la propia persona. 'recorded': lo manda
   * otra persona —el admin, al aprobar una solicitud— y el permiso ya se comprobó contra lo guardado en
   * la solicitud. En ese caso la IP, el navegador y la página son los del admin, no los de la persona,
   * así que NO se mandan a Meta junto con el correo de ella. */
  origin?: 'visitor' | 'recorded';
}

export interface CapiClientContext {
  ip?: string;
  userAgent?: string;
}

export function normalizePayload(payload: unknown): CapiPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as Record<string, unknown>;
  const eventName = String(candidate.event_name || '').trim();
  const eventId = String(candidate.event_id || '').trim();
  if (!eventName || !eventId) return null;

  const userDataRaw = candidate.user_data && typeof candidate.user_data === 'object'
    ? candidate.user_data as Record<string, unknown>
    : {};

  return {
    event_name: eventName,
    event_id: eventId,
    event_source_url: typeof candidate.event_source_url === 'string' ? candidate.event_source_url : undefined,
    user_data: {
      email: typeof userDataRaw.email === 'string' ? userDataRaw.email : undefined,
      phone: typeof userDataRaw.phone === 'string' ? userDataRaw.phone : undefined,
    },
    custom_data: candidate.custom_data && typeof candidate.custom_data === 'object'
      ? candidate.custom_data as Record<string, unknown>
      : undefined,
    origin: candidate.origin === 'recorded' ? 'recorded' : 'visitor',
  };
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildCapiEvent(
  payload: CapiPayload,
  client: CapiClientContext,
  eventTimeSeconds: number,
): Promise<Record<string, unknown>> {
  const recorded = payload.origin === 'recorded';

  const userData: Record<string, unknown> = {};
  if (payload.user_data?.email) userData.em = [await sha256Hex(payload.user_data.email)];
  if (payload.user_data?.phone) userData.ph = [await sha256Hex(payload.user_data.phone.replace(/\D/g, ''))];
  if (!recorded) {
    if (client.ip) userData.client_ip_address = client.ip;
    if (client.userAgent) userData.client_user_agent = client.userAgent;
  }

  return {
    event_name: payload.event_name,
    event_time: eventTimeSeconds,
    event_id: payload.event_id,
    ...(recorded ? {} : { event_source_url: payload.event_source_url }),
    // Meta exige IP, navegador y página para «website»; un evento del servidor, sin ellos, es
    // «system_generated».
    action_source: recorded ? 'system_generated' : 'website',
    user_data: userData,
    custom_data: payload.custom_data,
  };
}
