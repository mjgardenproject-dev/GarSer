// Borrado de las fotos de una reserva ya cerrada.
//
// Vivia dentro de `booking-complete`, que era quien cerraba las reservas. Al pasar el cierre a
// manos del cliente (o del reloj), esa funcion dejo de completar nada y la limpieza tenia que
// mudarse con el cierre, no quedarse donde estaba: si no, el boton "He terminado" del jardinero
// borraria las fotos de una reserva todavia abierta que puede acabar en incidencia, justo
// cuando esas fotos serian la prueba.
//
// Efecto secundario del traslado: las reservas autofinalizadas por el reloj NUNCA borraban sus
// fotos, porque el cron es SQL puro y no pasaba por aqui. Ahora si.

export interface MediaCleanupResult {
  status: 'completed' | 'skipped' | 'failed';
  attemptedObjectCount: number;
  deletedObjectCount: number;
  deletedRows: number;
  message?: string;
}

/**
 * Borra de Storage las fotos de una reserva y sus filas en `booking_media`.
 *
 * Nunca lanza: la limpieza es housekeeping y no puede tumbar el cierre de una reserva ni la
 * pasada del reloj. Devuelve el desenlace para que el llamante lo registre.
 */
// deno-lint-ignore no-explicit-any
export async function cleanupBookingMedia(admin: any, bookingId: string): Promise<MediaCleanupResult> {
  const result: MediaCleanupResult = {
    status: 'skipped',
    attemptedObjectCount: 0,
    deletedObjectCount: 0,
    deletedRows: 0,
  };

  try {
    const { data: mediaRows, error: mediaError } = await admin
      .from('booking_media')
      .select('storage_bucket, storage_path')
      .eq('booking_id', bookingId);

    if (mediaError) {
      return { ...result, status: 'failed', message: mediaError.message };
    }

    const groupedPaths = new Map<string, string[]>();
    for (const row of mediaRows || []) {
      const bucket = String(row.storage_bucket || '').trim();
      const path = String(row.storage_path || '').trim();
      if (!bucket || !path) continue;
      const paths = groupedPaths.get(bucket) || [];
      if (!paths.includes(path)) paths.push(path);
      groupedPaths.set(bucket, paths);
    }

    if (groupedPaths.size === 0) {
      return result;
    }

    result.attemptedObjectCount = Array.from(groupedPaths.values()).reduce((n, p) => n + p.length, 0);
    result.status = 'completed';

    for (const [bucket, paths] of groupedPaths.entries()) {
      const { error: removeError } = await admin.storage.from(bucket).remove(paths);
      if (removeError) {
        return { ...result, status: 'failed', message: removeError.message };
      }
      result.deletedObjectCount += paths.length;
    }

    const { data: deletedRows, error: deleteError } = await admin
      .from('booking_media')
      .delete()
      .eq('booking_id', bookingId)
      .select('id');

    if (deleteError) {
      return { ...result, status: 'failed', message: deleteError.message };
    }
    result.deletedRows = deletedRows?.length || 0;
    return result;
  } catch (error) {
    return { ...result, status: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}
