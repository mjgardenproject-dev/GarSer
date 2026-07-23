# GarSer — Mapa de la aplicación (auditoría 2026-07-12)

Generado como Paso 1 de la auditoría de producción. Tres inventarios: rutas, edge functions y datos.

---

## 1. Rutas (src/App.tsx)

Dos árboles de `<Routes>` condicionales según `isAdminPage` (App.tsx: admin en líneas 227-236, resto 247-501).

| Ruta | Componente | Auth/rol | Estado |
|------|-----------|----------|--------|
| `/` | PublicHomePage (→ /dashboard si sesión) | Pública | Activa |
| `/marbella` | MarbellaLandingPage | Pública | Activa |
| `/para-jardineros` | GardenersLandingPage | Pública | Activa |
| `/auth` | AuthForm | Pública | Activa |
| `/reset-password` | ResetPassword | Pública | Activa |
| `/dashboard` | ClientBookingLauncher \| GardenerDashboard \| →admin | ProtectedRoute | Activa (ramifica por rol) |
| `/status` | GardenerStatusPage | jardinero | Activa |
| `/apply` | GardenerApplicationWizard | jardinero | Activa |
| `/reserva`, `/reservar` | BookingFlow (wizard interno por currentStep) | Pública | Activa (funnel) |
| `/reserva/confirmacion` | ConfirmationPage | Pública | Activa |
| `/reserva/checkout`, `/reservar/checkout` | LegacyCheckoutRedirect | — | Redirección |
| `/service/:serviceId` | ServiceDetail | cliente | Activa |
| `/reservar/:gardenerId` | GardenerPublicProfile (QR) | Pública | Activa |
| `/booking` | LegacyBookingRedirect | — | Redirección |
| `/bookings` | BookingsList \| GardenerBookings | ProtectedRoute | Activa |
| `/chat` | ChatList | cualquiera | Activa |
| `/account` | MyAccount | cualquiera | Activa |
| `/debug-maps`, `/debug-roles` | GoogleMapsDebug, RoleDebug | DevelopmentRoute | Debug (gated por dev/`VITE_ENABLE_DEBUG_ROUTES`) |
| `/role-monitor` | RoleMonitor | AdminRoute allowInDevelopment | Debug |
| `/admin/{dashboard,services,phytosanitary,users,settings}` | AdminLayout + hijos | AdminProtectedRoute | Activas |
| `/admin/{applications,licenses}` | → users / phytosanitary | admin | Redirecciones |

**Anomalías del router:**
- App.tsx:499 — segunda `Route path="/"` **inalcanzable** (código muerto).
- **No hay catch-all 404**: URLs desconocidas renderizan layout con `<main>` vacío.
- `src/pages/reserva/checkout/BookingCheckoutPage.tsx` — **página huérfana** (nadie la importa).
- Enlaces rotos: **ninguno** (todos los navigate/Link resuelven).

## 2. Edge functions (supabase/functions/)

| Función | Invocada desde | Auth | verify_jwt | Notas |
|---|---|---|---|---|
| ai-pricing-estimator | aiPricingEstimator.ts:188,244 | solo gate JWT plataforma, sin getUser | true | Gemini; sin límite por usuario |
| booking-authority | bookingAuthorityService.ts:180 | getUser en código | false | Importa src/shared/bookingQuoteCore.ts |
| booking-complete | bookingCompletionService.ts:17 | getUser | true | |
| booking-confirmation-email | booking-payment-webhook/index.ts:620 (interna) | sin auth de llamante | true | Brevo; MOCK sin SMTP |
| booking-manual-declaration | bookingManualDeclarationService.ts:40 | getUser; re-valida server-side | true | |
| booking-payment | bookingPaymentService.ts:149 | getUser | false | Stripe |
| booking-payment-webhook | Stripe (webhook) | firma HMAC Stripe | false | Dispara email de confirmación |
| booking-telemetry | bookingTelemetry.ts:243 | auth opcional | false | Inserta con user_id null |
| send-email-notification | ApplicationsAdmin.tsx:53, bookingRequestService.ts:89 | sin auth de llamante | true | Brevo |

- Código compartido: `_shared/emailBrand.ts` (emails), `src/shared/bookingQuoteCore.ts` (SSOT precios, importado por booking-authority y booking-payment y por todo el front).
- Llamadas rotas front→función: **ninguna**.
- **Desincronización local ↔ desplegado** (por fechas de `supabase functions list` vs git):
  - `booking-payment-webhook` desplegado v10 **2026-05-25** < commits locales f2a6955 (30-may) y a4dd248 (21-jun, integración emails) → **el webhook en producción NO invoca booking-confirmation-email**.
  - `booking-telemetry` desplegado 20-may < último commit 30-may.
  - `booking-payment` desplegado 03-jun 14:44 < commit 26537d8 03-jun 19:19 (ambiguo, ~5h).
  - `booking-complete` desplegado 18-may 16:06 < commit 18-may 19:46 (ambiguo).
  - `send-email-notification` y `booking-confirmation-email` desplegados 11-jul 13:26 < commit b96d6e3 11-jul 15:32 (ambiguo, patrón deploy-antes-de-commit).
  - **`email-otp` desplegada en producción (dic-2025) pero NO existe en el repo** y nadie la referencia.

## 3. Datos (85 migraciones)

- **Todas las tablas tienen RLS habilitado.** `stripe_webhook_events` y `booking_schedule_hold_blocks`: RLS sin policies + REVOKE ALL → solo service_role (correcto).
- Tablas server-side (solo RPC/edge): booking_requests/responses/blocks/quotes, booking_funnel_events, booking_payment_attempts, booking_schedule_holds(+blocks), booking_rpc_idempotency(+batch), stripe_webhook_events, ai_analysis_logs.
- **Políticas permisivas detectadas:**
  - `profiles` — SELECT `USING(true)` para **anon** + `GRANT SELECT TO anon` (20250929000001_anonymous_booking_access.sql:89-96,117), **nunca revocado**. Columnas: full_name, phone, address, avatar_url → **fuga de PII, verificada en migraciones**.
  - `services`, `gardener_profiles`, `availability`, `gardener_service_prices`, `service_images`, `app_settings` — SELECT público (por diseño del funnel; razonable).
  - `role_logs`, `availability_blocks` — `USING(true)` heredado de fix_database_issues.sql:37,71.
- `bookings`: policies anon dropeadas + REVOKE en hardening (20260513/20260515) — correcto.
- Tablas muertas: `suggestion_chats`, `suggestion_messages` (nadie las usa).
- `src/types/supabase.ts` desactualizado: faltan app_settings, chat_thread_reads, booking_manual_declarations, booking_variable_revisions.
- RPCs del front: 10, todas existen en migraciones. Sin huérfanas.
- Storage: booking-photos (privado, anon retirado en hardening), private_licenses (privado, owner+admin), **applications (PÚBLICO — avatares y documentos de solicitud)**, marketing-assets (público, escritura admin), service-backgrounds (público).

## 4. Estado de toolchain (verificado 2026-07-12)

- `npm run build` ✅ (bundle único 1.431 kB / 376 kB gzip — sin code-splitting, warning de Vite).
- `npx vitest run` ✅ 356/356 tests en 62 archivos.
- `npm run lint` — 3 errores (2× ban-ts-comment en ApplicationsAdmin.tsx:97,132; 1× prefer-const en ProvidersPage.tsx:402) + 816 warnings.
- `.env*` fuera de git (solo .env.example trackeado). ✅
- `package.json` script `seed:services` referencia `seed_services.js` **inexistente**.
