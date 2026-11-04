# Avisos al administrador (2026-11-04)

Encargo del dueño: *«crea una notificación de app y correo electrónico para la cuenta de admin cuando reciba novedades (nuevas solicitudes de jardinero, de licencias, incidencias… todo lo que conlleve revisión del admin)»*.

## Qué avisa

| Novedad | Tabla / estado que la dispara | Botón del correo |
|---|---|---|
| Solicitud de alta de jardinero | `gardener_applications` → `submitted` (al crearse o al pasar a `submitted`) | Admin → Usuarios |
| Solicitud de alta de empresa | `company_applications` → `submitted` | Admin → Usuarios |
| Carnet fitosanitario | `gardener_licenses` → INSERT con `pending` (también el de un empleado subido por su empresa) | Admin → Certificados Fito. |
| Incidencia de una reserva | `booking_incidents` → INSERT con `open` | Admin → Incidencias |

A **todos** los administradores (`profiles.role = 'admin'`), por **correo** y por **notificación al móvil** (los dispositivos que la hayan activado en «Mi cuenta»). En el menú del panel, número rojo en *Usuarios*, *Certificados Fito.* e *Incidencias*.

## Cómo funciona

1. Un *trigger* por tabla llama a `private.enqueue_admin_review(kind, id, sello)` → una fila `admin_review_needed` en `notification_outbox` (la misma cola que ya usan los correos de reservas y carnets), **en la misma transacción** que la novedad. La fila solo lleva `{kind, itemId}`: ningún dato personal en la cola.
2. La campana `pg_net` (o el reloj de 1 minuto) despierta `notification-dispatch`, que reclama la fila y pide a `send-email-notification` el correo `admin_review_needed`.
3. `send-email-notification` (solo llamable como servicio interno): vuelve a leer la novedad, **comprueba que sigue pendiente** (si ya está resuelta, no avisa), saca los destinatarios de la base de datos (nunca de quien pide el correo), añade el resumen «Pendiente ahora» y manda correo + push a cada administrador. Si no se envía ningún correo, falla para que la cola reintente (hasta 5 veces con espera creciente).
4. `admin_pending_review_counts()` (solo administradores) da los números del menú; el menú los recalcula al navegar por el panel y al volver a la pestaña. Si la función aún no existe en la base, el menú sigue mostrando las incidencias como antes.

Garantías: una sola vez por novedad (`dedupe_key` con el sello de la novedad: una solicitud reenviada tras corregirla es otra novedad); un fallo al apuntar el aviso **nunca** tumba la acción del usuario (`EXCEPTION WHEN OTHERS`); aprobar/rechazar no avisa.

## Archivos

- `supabase/migrations/20261104150000_admin_review_notifications.sql`
- `supabase/functions/_shared/adminReviewEmailCopy.ts` (textos; sin dependencias de Deno, se prueba con vitest)
- `supabase/functions/_shared/adminReviewNotification.ts` (lectura de la novedad, contadores y destinatarios)
- `supabase/functions/send-email-notification/index.ts` (rama `admin_review_needed`)
- `src/components/admin/adminPendingCounts.ts` y `src/pages/admin/AdminLayout.tsx` (contadores del menú)
- Pruebas: `supabase/tests/admin_review_notifications.test.sql`, `src/shared/adminReview*.test.ts`, `src/pages/admin/AdminLayout.test.tsx`, `src/components/admin/adminPendingCounts.test.ts`
- Batería de producción: sección 30 de `docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md`

## Verificado en local

- SQL en el Postgres real de Supabase: avisos por cada tabla, borradores no avisan, sin duplicados, reenvío avisa de nuevo, una restricción que impide apuntar el aviso no tumba la acción, contadores solo para administradores, permisos (`anon` sin acceso).
- Cadena completa con funciones servidas en local: solicitud enviada → fila en la cola → campana → `notification-dispatch` → `send-email-notification` → correo simulado a 3 administradores (2 novedades) → fila `sent`.
- vitest 172 archivos / 2.677 pruebas; tipos 129 = línea base; build correcto.

**No** comprobado en local: el envío real por Brevo y la notificación al móvil (necesitan los secretos de producción).

## Lo que tienes que hacer tú

**En producción**
1. Aplicar la migración: `supabase db push` (la `20261104150000`).
2. Redesplegar la función: `supabase functions deploy send-email-notification --use-api`. (`notification-dispatch` no cambia.)
3. Desplegar la web (fusionar el PR) para ver los números en el menú.
4. Con tu cuenta de administrador, en el móvil: **Mi cuenta → Notificaciones** → activar. Sin esto llegan los correos pero no la notificación al móvil.
5. Comprobar que `SMTP_USER` / `SMTP_PASS` están en los secretos del proyecto (si los correos de reservas ya llegan, lo están).
6. Pasar la sección 30 de `PRUEBAS-PRODUCCION.md`.

**En local:** nada (ya aplicado).
