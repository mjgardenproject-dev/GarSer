// Lo que hace una baja después de la base de datos (F6 · D23, y pendientes PH-01 y PH-04).
//
// Lo usan `admin-account-closure` (la baja que hace el admin), `account-closure` (la que pide el
// propio usuario desde «Mi cuenta») y `booking-lifecycle-tick` (reintentos):
//   · `closeAuthAccess`: veto de acceso permanente y correo anónimo (deja libre el real).
//   · `cleanupAccountStorage`: borra sus ficheros de Storage. La baja ya apuntó en
//     `account_storage_cleanup` que hay que hacerlo, en su misma transacción; si aquí algo falla,
//     queda apuntado y el reloj lo reintenta. Nunca lanza: un fichero no puede deshacer una baja.

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export const MAX_STORAGE_CLEANUP_ATTEMPTS = 10;

export async function closeAuthAccess(admin: AdminClient, userId: string): Promise<string | null> {
  const { error } = await admin.auth.admin.updateUserById(userId, {
    email: `baja+${userId}@garser.invalid`,
    email_confirm: true,
    ban_duration: '876000h',
    user_metadata: {},
  });
  return error ? error.message : null;
}

export interface StorageCleanupResult {
  status: 'completed' | 'failed';
  deleted: number;
  message?: string;
}

export async function cleanupAccountStorage(admin: AdminClient, userId: string): Promise<StorageCleanupResult> {
  let deleted = 0;
  let message: string | undefined;
  try {
    const { data: objects, error } = await admin.rpc('account_storage_objects', { p_user_id: userId });
    if (error) throw new Error(error.message);
    const byBucket = new Map<string, string[]>();
    for (const row of (objects || []) as Array<{ bucket_id: string; name: string }>) {
      const list = byBucket.get(row.bucket_id) || [];
      list.push(row.name);
      byBucket.set(row.bucket_id, list);
    }
    for (const [bucket, names] of byBucket) {
      // La API de Storage borra de 1000 en 1000 como mucho.
      for (let i = 0; i < names.length; i += 500) {
        const chunk = names.slice(i, i + 500);
        const { error: removeError } = await admin.storage.from(bucket).remove(chunk);
        if (removeError) throw new Error(`${bucket}: ${removeError.message}`);
        deleted += chunk.length;
      }
    }
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  // Apuntar el desenlace (también si falla, para reintentarlo).
  const { data: row } = await admin.from('account_storage_cleanup').select('attempts, deleted_count').eq('user_id', userId).maybeSingle();
  const patch = {
    attempts: (row?.attempts || 0) + 1,
    deleted_count: (row?.deleted_count || 0) + deleted,
    last_error: message ?? null,
    completed_at: message ? null : new Date().toISOString(),
  };
  if (row) {
    await admin.from('account_storage_cleanup').update(patch).eq('user_id', userId);
  } else {
    await admin.from('account_storage_cleanup').insert({ user_id: userId, ...patch });
  }
  return message ? { status: 'failed', deleted, message } : { status: 'completed', deleted };
}

/** Reintenta las limpiezas que no terminaron (las llama el reloj). */
export async function retryPendingAccountStorageCleanup(admin: AdminClient, limit = 20) {
  const { data: pending, error } = await admin
    .from('account_storage_cleanup')
    .select('user_id')
    .is('completed_at', null)
    .lt('attempts', MAX_STORAGE_CLEANUP_ATTEMPTS)
    .order('requested_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  let completed = 0;
  let failed = 0;
  let deleted = 0;
  for (const row of pending || []) {
    const result = await cleanupAccountStorage(admin, row.user_id);
    deleted += result.deleted;
    if (result.status === 'completed') completed += 1; else failed += 1;
  }
  return { pending: (pending || []).length, completed, failed, deleted };
}
