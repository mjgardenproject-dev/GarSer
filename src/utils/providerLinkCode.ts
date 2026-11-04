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
/** Una clave guardada hace más de esto se olvida: el enlace habrá cambiado o el cliente ya no lo usa. */
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const PROVIDER_PATH = /^\/reservar\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

type StoredCodes = Record<string, { code: string; at: number }>;

const normalizeId = (providerId: string) => String(providerId || '').trim().toLowerCase();

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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(codes));
  } catch {
    // Sin almacenamiento (modo privado, cuota): la clave solo vale en esta carga de la página.
  }
}

export function rememberProviderLinkCode(providerId: string, code: string, now: number = Date.now()): void {
  const normalized = normalizeProviderLinkCode(code);
  const id = normalizeId(providerId);
  if (!normalized || !id) return;
  const all = readAll();
  // Se aprovecha para olvidar lo viejo.
  for (const [key, value] of Object.entries(all)) {
    if (!value || typeof value.at !== 'number' || now - value.at > MAX_AGE_MS) delete all[key];
  }
  all[id] = { code: normalized, at: now };
  writeAll(all);
}

/** La clave guardada para ese profesional, o null si no hay (o es antigua o está mal formada). */
export function recallProviderLinkCode(providerId: string, now: number = Date.now()): string | null {
  const entry = readAll()[normalizeId(providerId)];
  if (!entry || typeof entry.at !== 'number' || now - entry.at > MAX_AGE_MS) return null;
  return normalizeProviderLinkCode(entry.code);
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
  if (code) rememberProviderLinkCode(providerId, code);

  params.delete(PROVIDER_LINK_QUERY_PARAM);
  const search = params.toString();
  win.history.replaceState(win.history.state, '', `${win.location.pathname}${search ? `?${search}` : ''}${win.location.hash}`);
  return { providerId, saved: Boolean(code) };
}
