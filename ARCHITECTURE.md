# GarSer — Arquitectura (octubre de 2026)

> Reescrito el 2026-10-09 a partir del código (pendiente PH-06). Sustituye al documento de abril
> de 2026, que describía problemas ya resueltos. **Cada afirmación cita el fichero donde se
> comprueba.** Si cambias algo de lo que aquí se describe, actualiza este documento en el mismo
> cambio. El estado del proyecto Empresas y sus decisiones están en `docs/garser-empresas/`.

---

## 1. Piezas

| Pieza | Qué es | Dónde |
|---|---|---|
| Web | React + Vite + TypeScript, una sola aplicación para cliente, profesional, empresa, empleado y admin. Se puede instalar (PWA). | `src/main.tsx`, rutas en `src/App.tsx`, `public/sw.js` |
| Base de datos | Supabase (Postgres) con RLS. Todo el esquema está en migraciones. | `supabase/migrations/` |
| Funciones del servidor | Supabase Edge Functions (Deno). | `supabase/functions/<nombre>/index.ts`; código común en `supabase/functions/_shared/` |
| Pagos | Stripe. Al reservar se cobran los **gastos de gestión** (12,5 %); el resto lo paga el cliente al profesional. | `src/shared/bookingAmounts.ts` (`BOOKING_MANAGEMENT_FEE_RATE`), `supabase/functions/booking-payment/`, `booking-payment-webhook/` |
| Análisis con IA | Gemini estima medidas a partir de fotos, con cuota por usuario y lista blanca de orígenes de imagen. | `supabase/functions/ai-pricing-estimator/index.ts` |
| Correo | Brevo. Plantilla única con la marca. | `supabase/functions/_shared/emailBrand.ts`, `send-email-notification/` |
| Notificaciones al móvil | Web Push propio (RFC 8291 y VAPID), sin dependencias. | `supabase/functions/_shared/webPush.ts`, `_shared/pushDelivery.ts`, `src/utils/pushNotifications.ts` |

Código compartido entre la web y las funciones (el mismo fichero en los dos lados):

- `src/shared/bookingQuoteCore.ts`: el motor de presupuesto (precio, horas y avisos de cada
  servicio). Lo usan `booking-authority` y `booking-payment`. **Si se toca, hay que redesplegar
  esas dos funciones.**
- `src/domain/pricingEngine.ts` y `src/domain/pricing/`: fórmulas de precio que usa el motor.
- `src/shared/bookingAmounts.ts`: cómo se reparte el importe entre gastos de gestión y
  profesional.

## 2. El recorrido de una reserva

1. **Presupuesto.** La web pide a `booking-authority` (acciones `preview_providers`,
   `valid_hours`, `month_days`, `create_quote` y `recalculate_correction`) el precio y las horas de
   cada profesional que cubre la dirección y tiene hueco. El servidor calcula con el motor
   compartido; el navegador no decide precios (`supabase/functions/booking-authority/index.ts`).
   Los avisos del motor llegan a la web como texto.
2. **Pago.** `booking-payment` (`prepare_payment` y siguientes) aparta las horas y crea el intento
   de pago (`prepare_booking_payment_attempt_for_client`); el webhook de Stripe lo confirma
   (`confirm_booking_payment_attempt`) y nace la reserva en `pending`.
3. **Respuesta del profesional.** `respond_booking_request` (aceptar o rechazar) o proponer otro
   precio u otra duración (`propose_booking_price_change` / `respond_booking_price_change`).
   Todas son RPC `SECURITY DEFINER` con marcas de idempotencia que solo escribe el servidor
   (`booking_rpc_idempotency`, migración `20261009120000`).
4. **Antes del servicio.** La empresa puede mover la fecha con propuesta al cliente
   (`propose_booking_reschedule` / `respond_booking_reschedule`) o cambiar quién va.
5. **Cierre.** El profesional marca «He terminado»; el cliente confirma o abre una incidencia; si
   no responde, el reloj la cierra (`supabase/functions/booking-lifecycle-tick/index.ts`). El enlace
   de un clic del correo pasa por `booking-confirm-service`. `booking-complete` ya no cierra nada:
   es una capa de compatibilidad que delega en la misma RPC.

El navegador **no escribe** reservas ni horas directamente: lo hacen las RPC (migración
`20260713000001` y R-16 en `20260929100000_notification_outbox.sql`).

## 3. Proveedores: autónomos y empresas

- Un proveedor es una fila de `gardener_profiles` (autónomo o empresa); `bookings.gardener_id` es
  siempre el proveedor, también con empresas. Las empresas están en `companies` y su equipo en
  `company_members` (`docs/garser-empresas/01-PLAN-Y-PROGRESO.md`).
- **Disponibilidad:** una sola, declarada **por persona** en `availability` (horario fijo en
  `recurring_schedules`, que el reloj convierte en días). La empresa suma la de su equipo; no
  declara la suya.
- **Quién va:** las horas apartadas están en `booking_blocks` con `assignee_id`; el planificador
  decide quién hace cada hora (`plan_booking_cells`).
- **Altas:**
  - Jardinero: formulario `src/components/gardener/GardenerApplicationWizard.tsx`, enviado por
    `submit_gardener_application` (migración `20261009130000`); el admin revisa con
    `admin_review_gardener_application`; un rechazado reabre la misma solicitud con
    `restart_gardener_application` y el rechazo queda en `gardener_application_reviews`
    (`20261009110000`).
  - Empresa: `src/pages/empresa/CompanyApplicationPage.tsx` y `submit_company_application`.
  - Empleado: invitación con su propia alta (`supabase/functions/company-invitation-signup/`).
- **Suspender** corta las reservas nuevas (`gardener_profiles.suspended_at`;
  `booking-authority` lo excluye y un trigger no deja crear presupuestos); el profesional lo ve en
  su panel y recibe un correo (`src/components/common/SuspendedProviderNotice.tsx`, migración
  `20261009140000`).

## 4. Avisos: cola, correo y móvil

- Cada acción apunta su aviso en `notification_outbox` **en la misma transacción**, con clave
  contra duplicados (`private.enqueue_notification`, migración `20260929100000`).
- `notification-dispatch` lo reclama, lo pide a `send-email-notification` como servicio interno y
  reintenta (1, 5, 15 y 60 minutos). Lo despierta `pg_net` al apuntar y un reloj cada minuto.
- `send-email-notification` es **el único que redacta correos**. Si un navegador pide un tipo
  que gestiona la cola, lo ignora (`SERVER_MANAGED_TYPES`).
- Cada correo sale también al móvil si la persona lo activó (`pushForEmail`,
  `_shared/pushDelivery.ts`).
- Excepciones: la invitación de empleados (lleva el código en claro) y los correos de
  confirmación de reserva (`booking-confirmation-email`).

## 5. Seguridad: qué puede hacer el navegador

- **Lee** lo suyo y lo que comparte (reglas de cada tabla en `pg_policies`).
- **Escribe** solo lo que es suyo y no tiene consecuencias para otros: su perfil, su borrador de
  alta, sus horarios y precios, sus mensajes de chat y sus reseñas. Las reservas, pagos,
  asignaciones, revisiones y marcas de idempotencia van por RPC o funciones del servidor.
- **Funciones con `verify_jwt = false`** (`supabase/config.toml`): comprueban por sí mismas quién
  llama (`supabase/functions/_shared/functionAuth.ts`), porque las claves modernas de Supabase no
  son JWT.
- **Ficheros (Storage):** cada fichero lo listan o descargan su dueño, quien comparte esa reserva
  y el admin (`public.can_read_booking_photo`, migración `20261009100000`). `applications` es
  público por enlace (fotos de perfil y de la solicitud); `booking-photos` lo es en producción y no en local
  (pendiente PH-16).
- **Nunca** se acepta del navegador un `company_id` ni un usuario ajeno: se deriva de la sesión.

## 6. Cuentas y datos personales

- **Bajas:** una sola lógica para el admin y para el propio usuario
  (`private.execute_account_closure`, migración `20261009100000`; funciones
  `admin-account-closure` y `account-closure`).
  - Sin historial, se borra todo.
  - Con historial, se quitan los datos personales y el acceso, y se conservan reservas e
    importes.
  - Si hay algo sin terminar, no se hace nada y se dice qué falta.
- **Ficheros de una baja:** se apuntan en `account_storage_cleanup` en la misma transacción, se
  borran justo después y el reloj reintenta los que fallen
  (`supabase/functions/_shared/accountClosure.ts`).
- Las fotos de una reserva se borran al cerrarla (`_shared/bookingMediaCleanup.ts`). Los chats
  se conservan.

## 7. Despliegue y operaciones

- **Migraciones:** `npx supabase db push` contra producción.
  - Siempre antes que las funciones que las necesitan.
  - Copia de seguridad antes (`docs/garser-empresas/07-PROCEDIMIENTO-CORRECCION.md` §4,
    fase H).
- **Funciones:** `npx supabase functions deploy <nombre> --use-api`; sin `--use-api` se cuelga
  en esta máquina.
  - Si se toca `src/shared/bookingQuoteCore.ts`, redesplegar `booking-authority` y
    `booking-payment`.
  - Si se toca `_shared/`, redesplegar las funciones que lo importan.
- **Relojes** (`cron.job`):

  | Reloj | Frecuencia |
  |---|---|
  | `booking-lifecycle-maintenance` | 15 min |
  | `expire-price-change-proposals` | 15 min |
  | `notification-outbox-dispatch` | 1 min |
  | `roll-recurring-availability` | diario |
  | Purgas de los registros de IA | diarias |

  El reloj del ciclo de vida usa el secreto `lifecycle_tick_secret` del Vault.
- **Secretos de las funciones:** `supabase secrets set --env-file <fichero temporal>`, nunca con el
  valor en la orden. En local están en `supabase/functions/.env`, fuera de git.

## 8. Pruebas

| Qué | Dónde | Cómo |
|---|---|---|
| Unitarias (web y código compartido) | `src/**/*.test.ts(x)` | `npx vitest run` |
| Baterías de Empresas, contra el Supabase local | `scripts/garser-empresas/verify-*.mjs` | `node <fichero>`. Necesitan `npx supabase functions serve` y el Vault local. |
| Preparación de cada servicio (precios, horas, avisos) | `scripts/readiness/<servicio>.mjs` | Por HTTP o con `READINESS_ENGINE=local` |
| Embudo de reserva de punta a punta | `scripts/qa/manual-entry/` | — |
| Pruebas en producción | `docs/garser-empresas/03-PRUEBAS.md` §3 y la guía de `06-PRUEBA-REAL-PENDIENTE.md` §3 | — |
