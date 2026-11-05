import { useSyncExternalStore } from 'react';
import type { OAuthSignInResult } from './oauthAccount';

// El paso que queda por aclarar DESPUÉS de entrar con Google (2026-11-04): preguntar el tipo de
// cuenta a quien acaba de crearse una, o explicar por qué lo que eligió no se pudo dejar así.
//
// Vive fuera de los componentes a propósito: en cuanto hay sesión, App.tsx cambia todas las rutas
// por la pantalla «Cargando…» mientras lee el tipo de cuenta, y /auth (o /auth/callback) se
// desmonta y se vuelve a montar. Con el estado dentro del componente, la pregunta se perdía y la
// persona se quedaba sin ver nada ni elegir. Aquí sobrevive a ese desmontaje (no a recargar la
// página, que es lo que se quiere: no se arrastra a otra visita).

export interface PendingAuthStep {
  kind: 'chooser' | 'problem';
  result: OAuthSignInResult;
}

let current: PendingAuthStep | null = null;
let currentAt = 0;
const listeners = new Set<() => void>();

export const getPendingAuthStep = (): PendingAuthStep | null => current;

/** Hace cuánto se dejó el paso pendiente (ms), o null si no hay. */
export const pendingAuthStepAgeMs = (now: number = Date.now()): number | null => (current ? now - currentAt : null);

export function setPendingAuthStep(next: PendingAuthStep | null): void {
  current = next;
  currentAt = next ? Date.now() : 0;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** El paso pendiente, que se actualiza solo en cuanto cambia. */
export const usePendingAuthStep = (): PendingAuthStep | null =>
  useSyncExternalStore(subscribe, getPendingAuthStep, getPendingAuthStep);
