import { normalizeProviderLinkCode } from '../shared/commissionRules';
import { PROVIDER_LINK_QUERY_PARAM } from '../shared/providerLinkUrl';

/**
 * La clave del enlace de un profesional, del lado del cliente.
 *
 * Quien abre garser.es/reservar/<id>?c=<clave> trae la clave en la dirección. Se hace dos cosas con
 * ella nada más arrancar la web, ANTES de que se pinte nada ni arranque ninguna herramienta de
 * medición (el Pixel de Meta manda la dirección completa de cada página):
 *   1. se guarda en este navegador, ligada a ese profesional (para que la reserva pueda llevarla);
 *   2. se quita de la barra de direcciones.
 *
 * La clave no es una contraseña (solo sirve para reservar con ese profesional y no pagar gastos de
 * gestión), pero tampoco tiene por qué viajar a terceros ni quedar en capturas de pantalla.
 */

const STORAGE_KEY = 'garser.providerLinkCodes.v1';
/**
 * Ventana de atribución (QA-101): 30 días, lo habitual en programas de afiliados. Pasado ese tiempo
 * la clave se olvida; si el cliente ya reservó por el enlace, su cuenta lo recuerda en el servidor
 * (la relación con el profesional queda fijada con su primera reserva) y no la necesita.
 */
export const PROVIDER_LINK_CODE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PROVIDER_PATH = /^\/reservar\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/**
 * Cada clave va ligada a quien llegó con ella (QA-101): `userId` es la cuenta con la que se entró por
 * el enlace, o null si se llegó sin sesión (la reclama la primera cuenta que inicie sesión después).
 * En un móvil o una tablet compartidos la clave no pasa a otra persona: se borra al cerrar sesión y
 * no vale para otra cuenta.
 */
type StoredCode = { code: string; at: number; userId?: string | null };
type StoredCodes = Record<string, StoredCode>;

const normalizeId = (providerId: string) => String(providerId || '').trim().toLowerCase();
const normalizeUser = (userId: string | null | undefined) => {
  const id = String(userId || '').trim().toLowerCase();
  return id || null;
};

function readAll(): StoredCodes {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as StoredCodes) : {};
  } catch {
    return {};
  }
}

function writeAll(codes: StoredCodes) {
  try {
    if (Object.keys(codes).length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(codes));
  } catch {
    // Sin almacenamiento (modo privado, cuota): la clave solo vale en esta carga de la página.
  }
}

const isFresh = (entry: StoredCode | undefined, now: number): entry is StoredCode =>
  Boolean(entry) && typeof entry!.at === 'number' && now - entry!.at <= PROVIDER_LINK_CODE_MAX_AGE_MS && now >= entry!.at - 60_000;

/**
 * La cuenta con sesión abierta en este navegador, leída de lo que guarda Supabase, sin esperar a la
 * red. Sirve para ligar la clave al llegar por el enlace (se captura antes de arrancar la web).
 */
export function readStoredSessionUserId(storage: Pick<Storage, 'length' | 'key' | 'getItem'> = window.localStorage): string | null {
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i) || '';
      if (!/^sb-.+-auth-token$/.test(key)) continue;
      const parsed = JSON.parse(storage.getItem(key) || 'null') as { user?: { id?: unknown } } | null;
      const id = normalizeUser(typeof parsed?.user?.id === 'string' ? parsed.user.id : null);
      if (id) return id;
    }
  } catch {
    // Sesión ilegible: se trata como visitante sin sesión.
  }
  return null;
}

export function rememberProviderLinkCode(
  providerId: string,
  code: string,
  options: { userId?: string | null; now?: number } = {},
): void {
  const now = options.now ?? Date.now();
  const normalized = normalizeProviderLinkCode(code);
  const id = normalizeId(providerId);
  if (!normalized || !id) return;
  const all = readAll();
  // Se aprovecha para olvidar lo viejo.
  for (const [key, value] of Object.entries(all)) {
    if (!isFresh(value, now)) delete all[key];
  }
  all[id] = { code: normalized, at: now, userId: normalizeUser(options.userId) };
  writeAll(all);
}

/**
 * La clave guardada para ese profesional y esa cuenta, o null si no hay (o es antigua, está mal
 * formada o es de otra cuenta). Una clave de un visitante sin sesión pasa a ser de la cuenta que la
 * usa por primera vez; la de otra cuenta se borra.
 */
export function recallProviderLinkCode(
  providerId: string,
  options: { userId?: string | null; now?: number } = {},
): string | null {
  const now = options.now ?? Date.now();
  const userId = normalizeUser(options.userId);
  const all = readAll();
  const key = normalizeId(providerId);
  const entry = all[key];
  if (!isFresh(entry, now)) return null;
  const owner = normalizeUser(entry.userId);
  if (owner && owner !== userId) {
    // De otra cuenta: en este navegador ya no le sirve a nadie más.
    if (userId) {
      delete all[key];
      writeAll(all);
    }
    return null;
  }
  if (!owner && userId) {
    all[key] = { ...entry, userId };
    writeAll(all);
  }
  return normalizeProviderLinkCode(entry.code);
}

/**
 * Al iniciar sesión: las claves de visitante pasan a esta cuenta y las de otra cuenta se borran.
 */
export function bindProviderLinkCodesToUser(userId: string | null | undefined, now: number = Date.now()): void {
  const id = normalizeUser(userId);
  if (!id) return;
  const all = readAll();
  let changed = false;
  for (const [key, value] of Object.entries(all)) {
    const owner = normalizeUser(value?.userId);
    if (!isFresh(value, now) || (owner && owner !== id)) {
      delete all[key];
      changed = true;
    } else if (!owner) {
      all[key] = { ...value, userId: id };
      changed = true;
    }
  }
  if (changed) writeAll(all);
}

/** Al cerrar sesión: este navegador olvida todas las claves de enlace. */
export function clearProviderLinkCodes(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Sin almacenamiento: no hay nada que borrar.
  }
}

export function forgetProviderLinkCode(providerId: string): void {
  const all = readAll();
  if (delete all[normalizeId(providerId)]) writeAll(all);
}

type LocationLike = Pick<Location, 'pathname' | 'search' | 'hash'>;
type HistoryLike = Pick<History, 'replaceState' | 'state'>;

/**
 * Si la dirección actual es la de un profesional y lleva `?c=`, guarda la clave y la quita de la
 * dirección (el resto de parámetros, como `utm_source`, se respeta). Devuelve lo que ha hecho, para
 * poder probarlo; la web no lo usa.
 */
export function captureProviderLinkCodeFromUrl(
  win: { location: LocationLike; history: HistoryLike } = window,
): { providerId: string; saved: boolean } | null {
  const match = PROVIDER_PATH.exec(win.location.pathname);
  if (!match) return null;
  const params = new URLSearchParams(win.location.search);
  if (!params.has(PROVIDER_LINK_QUERY_PARAM)) return null;

  const providerId = match[1].toLowerCase();
  const code = normalizeProviderLinkCode(params.get(PROVIDER_LINK_QUERY_PARAM));
  if (code) rememberProviderLinkCode(providerId, code, { userId: readStoredSessionUserId() });

  params.delete(PROVIDER_LINK_QUERY_PARAM);
  const search = params.toString();
  win.history.replaceState(win.history.state, '', `${win.location.pathname}${search ? `?${search}` : ''}${win.location.hash}`);
  return { providerId, saved: Boolean(code) };
}
