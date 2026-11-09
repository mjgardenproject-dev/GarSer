// Tipo de cuenta de un usuario de GarSer. Fuente única de verdad: `profiles.role`, que crea y
// protege el servidor (migración 20260923120000, F0 de GarSer Empresas).
//
// No se deduce de `user_metadata` ni de `localStorage`: los dos los controla el propio usuario.
//
// Hay UN solo tipo de profesional, `gardener` (D31, 2026-11-08): que sea autónomo o lleve un equipo
// es un MODO que se deriva de sus empleados (`useProviderMode`), no un tipo de cuenta. El valor
// `company` sigue admitido por el CHECK de la base de datos, pero ya no se asigna a nadie; si llegara
// (una cuenta anterior a la migración 20261108120000, un valor viejo en el navegador) la web lo trata
// como profesional.

export const ACCOUNT_ROLES = ['client', 'gardener', 'admin', 'employee'] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export function normalizeAccountRole(value: unknown): AccountRole | null {
  if (value === 'company') return 'gardener';
  return typeof value === 'string' && (ACCOUNT_ROLES as readonly string[]).includes(value)
    ? (value as AccountRole)
    : null;
}
