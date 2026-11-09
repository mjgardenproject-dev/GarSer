import type { ProviderMode } from './providerMode';

// El aviso de «tu cuenta ha cambiado de modo» (D39). Lo ÚNICO que se guarda en el navegador es el último
// modo que se vio, y solo sirve para saber si hay que enseñar el aviso de una transición: nunca para decidir
// qué panel se pinta (eso lo decide siempre el servidor). Si el almacenamiento falla o se borra, lo peor que
// pasa es que no sale el aviso.

export type ModeTransition = 'to_team' | 'to_individual';

const KEY_PREFIX = 'garser.providerMode.lastSeen:';
const isMode = (value: unknown): value is ProviderMode => value === 'individual' || value === 'team';

export function readLastSeenMode(userId: string): ProviderMode | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + userId);
    return isMode(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeLastSeenMode(userId: string, mode: ProviderMode): void {
  try {
    localStorage.setItem(KEY_PREFIX + userId, mode);
  } catch { /* sin almacenamiento: no habrá aviso, nada más */ }
}

/** ¿Cambió el modo desde la última vez? Sin dato previo (primer acceso, otro navegador) no es un cambio. */
export function modeTransition(lastSeen: ProviderMode | null, current: ProviderMode | null): ModeTransition | null {
  if (!lastSeen || !current || lastSeen === current) return null;
  return current === 'team' ? 'to_team' : 'to_individual';
}
