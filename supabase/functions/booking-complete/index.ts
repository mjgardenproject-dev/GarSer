import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function resolveServiceRoleKey() {
  const modernSecretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (modernSecretKeys) {
    try {
      const parsed = JSON.parse(modernSecretKeys) as Record<string, string>;
      const preferred = parsed.default || Object.values(parsed)[0];
      if (preferred) return preferred;
    } catch {
      // Fallback to legacy key below.
    }
  }

  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
}

async function resolveUser(admin: ReturnType<typeof createClient>, req: Request) {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function recordCleanupEvent(
  admin: ReturnType<typeof createClient>,
  params: {
    userId?: string | null;
    level: 'info' | 'warn' | 'error';
    event: string;
    bookingId: string;
    context?: Record<string, unknown>;
  },
) {
  try {
    await admin.from('booking_funnel_events').insert({
      user_id: params.userId || null,
      level: params.level,
      event: params.event,
      source: 'booking-complete-edge',
      path: '/functions/v1/booking-complete',
      context: {
        bookingId: params.bookingId,
        ...(params.context || {}),
      },
    });
  } catch {
    // Telemetry must never block booking completion.
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { bookingId } = (await req.json()) as { bookingId?: string };
    const normalizedBookingId = String(bookingId || '').trim();

    if (!normalizedBookingId) {
      return new Response(JSON.stringify({ error: 'Falta bookingId.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = resolveServiceRoleKey();

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Faltan secretos de Supabase para booking-complete.');
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    });

    const user = await resolveUser(admin, req);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Debes iniciar sesión.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: booking, error: bookingError } = await admin
      .from('bookings')
      .select('id, gardener_id, status, date, start_time, duration_hours')
      .eq('id', normalizedBookingId)
      .single();

    if (bookingError || !booking) {
      return new Response(JSON.stringify({ error: 'Reserva no encontrada.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (String(booking.gardener_id || '').trim() !== user.id) {
      return new Response(JSON.stringify({ error: 'No puedes completar esta reserva.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const currentStatus = String(booking.status || '').trim();
    // `in_progress` se elimina del ciclo (paso 8C): era inalcanzable, nadie lo escribía.
    if (!['confirmed', 'completed'].includes(currentStatus)) {
      return new Response(JSON.stringify({ error: 'La reserva no está en un estado completable.' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // VENTANA DE COMPLETADO (paso 8C): no se puede dar por finalizado un servicio que aún no
    // ha terminado. Sin esta guarda se podía cerrar —y con la captura diferida, COBRAR— una
    // reserva de dentro de 3 días. Se valida aquí y no solo ocultando el botón, porque el
    // front no es una frontera de seguridad.
    if (currentStatus === 'confirmed') {
      const serviceDate = String(booking.date || '').trim();
      const serviceStart = String(booking.start_time || '00:00:00').slice(0, 8);
      const durationHours = Math.max(Number(booking.duration_hours) || 1, 1);
      const serviceEnd = serviceDate ? new Date(`${serviceDate}T${serviceStart}Z`) : null;
      if (serviceEnd && !Number.isNaN(serviceEnd.getTime())) {
        serviceEnd.setUTCHours(serviceEnd.getUTCHours() + durationHours);
        if (Date.now() < serviceEnd.getTime()) {
          return new Response(
            JSON.stringify({
              error: 'Todavía no puedes cerrar esta reserva: el servicio aún no ha terminado.',
              code: 'service_not_finished_yet',
              serviceEndsAt: serviceEnd.toISOString(),
            }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
      }
    }

    if (currentStatus !== 'completed') {
      const { error: updateError } = await admin
        .from('bookings')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', normalizedBookingId)
        .eq('gardener_id', user.id);

      if (updateError) {
        throw updateError;
      }

      // Email al cliente pidiendole la valoracion. Se dispara AQUI y no en el trigger porque
      // SQL no puede invocar una edge function sin pg_net, y meter la clave de servicio en la
      // base de datos para lograrlo es peor negocio que este alcance parcial.
      //
      // ALCANCE: cubre la finalizacion MANUAL. Las autofinalizadas a las 24 h (paso 8C, puro
      // SQL) reciben el aviso del CHAT -que si cubre las dos vias por ir en el trigger- pero
      // todavia no el email. Anotado en el plan como Fase 2b.
      //
      // No bloquea la respuesta: si el email falla, la reserva ya esta completada y eso es lo
      // que importa. Pero se registra, porque un email que no sale sin dejar rastro es
      // exactamente el fallo que tuvimos durante semanas.
      try {
        const { error: reviewEmailError } = await admin.functions.invoke('send-email-notification', {
          body: { type: 'booking_review_request', bookingId: normalizedBookingId },
        });
        if (reviewEmailError) {
          console.error(
            `[booking-complete] No se pudo pedir la valoracion por email | booking ${normalizedBookingId} | ${reviewEmailError.message}`,
          );
        }
      } catch (reviewEmailException) {
        console.error(
          `[booking-complete] Excepcion al pedir la valoracion por email | booking ${normalizedBookingId} |`,
          reviewEmailException,
        );
      }
    }

    const { data: mediaRows, error: mediaError } = await admin
      .from('booking_media')
      .select('storage_bucket, storage_path')
      .eq('booking_id', normalizedBookingId);

    if (mediaError) {
      throw mediaError;
    }

    const groupedPaths = new Map<string, string[]>();
    for (const row of mediaRows || []) {
      const bucket = String(row.storage_bucket || '').trim();
      const path = String(row.storage_path || '').trim();
      if (!bucket || !path) continue;
      const currentPaths = groupedPaths.get(bucket) || [];
      if (!currentPaths.includes(path)) currentPaths.push(path);
      groupedPaths.set(bucket, currentPaths);
    }

    let cleanupStatus: 'completed' | 'skipped' | 'failed' = groupedPaths.size === 0 ? 'skipped' : 'completed';
    let deletedObjectCount = 0;
    const attemptedObjectCount = Array.from(groupedPaths.values()).reduce((sum, paths) => sum + paths.length, 0);
    let cleanupWarning: string | undefined;

    for (const [bucket, paths] of groupedPaths.entries()) {
      const { error: removeError } = await admin.storage.from(bucket).remove(paths);
      if (removeError) {
        cleanupStatus = 'failed';
        cleanupWarning = 'La reserva se ha completado, pero la limpieza de fotos no ha terminado correctamente.';
        await recordCleanupEvent(admin, {
          userId: user.id,
          level: 'warn',
          event: 'booking.media_cleanup_storage_failed',
          bookingId: normalizedBookingId,
          context: {
            bucket,
            attemptedObjectCount,
            message: removeError.message,
          },
        });
        break;
      }
      deletedObjectCount += paths.length;
    }

    let deletedRows = 0;
    if (cleanupStatus !== 'failed') {
      const { data: deletedMediaRows, error: deleteRowsError } = await admin
        .from('booking_media')
        .delete()
        .eq('booking_id', normalizedBookingId)
        .select('id');

      if (deleteRowsError) {
        cleanupStatus = 'failed';
        cleanupWarning = 'La reserva se ha completado, pero la limpieza de referencias de fotos no ha terminado correctamente.';
        await recordCleanupEvent(admin, {
          userId: user.id,
          level: 'warn',
          event: 'booking.media_cleanup_rows_failed',
          bookingId: normalizedBookingId,
          context: {
            attemptedObjectCount,
            deletedObjectCount,
            message: deleteRowsError.message,
          },
        });
      } else {
        deletedRows = deletedMediaRows?.length || 0;
      }
    }

    await recordCleanupEvent(admin, {
      userId: user.id,
      level: cleanupStatus === 'failed' ? 'warn' : 'info',
      event: cleanupStatus === 'failed' ? 'booking.media_cleanup_failed' : 'booking.media_cleanup_succeeded',
      bookingId: normalizedBookingId,
      context: {
        cleanupStatus,
        attemptedObjectCount,
        deletedObjectCount,
        deletedRows,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      bookingId: normalizedBookingId,
      cleanup: {
        status: cleanupStatus,
        deletedRows,
        attemptedObjectCount,
        deletedObjectCount,
        warning: cleanupWarning,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno al completar la reserva.';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
