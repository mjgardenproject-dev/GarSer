// Borradores que sobreviven a un cierre de sesión inesperado en la misma pestaña (R-06): si la
// sesión se cae mientras el proveedor escribe una propuesta, al volver a entrar la recupera.
// sessionStorage (no localStorage): muere con la pestaña, y el cierre de sesión normal la vacía
// (AuthContext.clearAuthStorage). La clave lleva el usuario: otra cuenta en la misma pestaña no
// ve borradores ajenos.

export type PriceDraft = { amount: string; reason: string; duration?: string };

const key = (userId: string) => `garser:price-drafts:${userId}`;

export function readPriceDrafts(userId: string | null | undefined): Record<string, PriceDraft> {
  if (!userId) return {};
  try {
    const raw = sessionStorage.getItem(key(userId));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writePriceDrafts(userId: string | null | undefined, drafts: Record<string, PriceDraft & { loading?: boolean }>): void {
  if (!userId) return;
  const clean: Record<string, PriceDraft> = {};
  for (const [id, d] of Object.entries(drafts)) {
    const entry: PriceDraft = { amount: d.amount || '', reason: d.reason || '', duration: d.duration || '' };
    if (entry.amount.trim() || entry.reason.trim() || (entry.duration || '').trim()) clean[id] = entry;
  }
  try {
    if (Object.keys(clean).length === 0) sessionStorage.removeItem(key(userId));
    else sessionStorage.setItem(key(userId), JSON.stringify(clean));
  } catch {
    /* almacenamiento bloqueado: el borrador vive solo en memoria */
  }
}
