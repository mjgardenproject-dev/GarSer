// Tipo de cuenta de un usuario de GarSer. Fuente única de verdad: `profiles.role`, que crea y
// protege el servidor (migración 20260923120000, F0 de GarSer Empresas).
//
// No se deduce de `user_metadata` ni de `localStorage`: los dos los controla el propio usuario.
// `company` y `employee` existen en la base de datos pero ningún flujo los asigna todavía.

export const ACCOUNT_ROLES = ['client', 'gardener', 'admin', 'company', 'employee'] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export function normalizeAccountRole(value: unknown): AccountRole | null {
  return typeof value === 'string' && (ACCOUNT_ROLES as readonly string[]).includes(value)
    ? (value as AccountRole)
    : null;
}
