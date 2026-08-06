# Estado de la auditoría de producción — checkpoint

Última actualización: 2026-07-13. Carpeta de trabajo: `docs/audit/2026-07-12/`.

## 🔧 IMPLEMENTACIÓN (rama fix/pre-produccion)
- **Paso 0** ✅ rama creada, baseline verde (356 tests, build ok, 3 errores lint preexistentes).
- **Paso 1** ✅ (local, pendiente de aprobación del usuario) — cierre de fuga PII:
  - Migración `20260713000000_secure_pii_access.sql`: vista `public_gardener_directory` (vitrina sin phone/address), REVOKE SELECT anon en profiles/gardener_profiles, DROP policies USING(true), policies de contraparte (bookings + booking_requests/responses).
  - Repunteados a la vista: ProvidersPage.tsx:397, GardenerPublicProfile.tsx:23, ConfirmationPage.tsx:826.
  - Tipos regenerados (`supabase gen types --local`) → incluye la vista + las 4 tablas que faltaban.
  - Test ProvidersPage mock actualizado. Verificado: curl anon a profiles/gardener_profiles → permission denied; vista → OK sin phone/address; 356 tests verdes; build ok; app arranca sin errores.
  - **Pendiente producción (fase final):** aplicar esta migración a la BD real (ya registrada en el sistema de migraciones tras `db reset`).
  - **Nota entorno local:** el Storage local (storage-api v1.58.17) tiene el esquema desincronizado (falta columna `level`); ni `db reset` ni actualizar el CLI (2.98.2→2.109.1) lo resolvieron. Es desajuste de tooling del stack de desarrollo, NO afecta a código ni a producción. Consecuencia: las subidas a Storage fallan SOLO en local. Los dos `db reset` borraron los datos de prueba locales. Hallazgo real de producción aparte: HEIC rechazado en onboarding (registrado en 01-static-findings, ALTO).

- **Paso 2** ✅ (local, pendiente aprobación) — blindaje de escritura directa de `bookings`:
  - Migración `20260713000001_harden_bookings_writes.sql`: REVOKE INSERT (solo RPC SECURITY DEFINER crean reservas), UPDATE restringido a la columna `status` (column-level grant) → `total_price` y demás campos congelados para escritura directa; drop de policies laxas.
  - **Corrección de defecto del paso 1:** las policies de contraparte de profiles/gardener_profiles causaban RECURSIÓN INFINITA (profiles→bookings→profiles). Corregido con función `shares_booking_with(uuid)` SECURITY DEFINER que rompe el ciclo. Migración del paso 1 (20260713000000) editada en la fuente para usarla.
  - Verificado por API REST con JWT de usuario: status='confirmed' → 200 ✓; total_price=1 → 403 ✓; INSERT con precio inventado → 403 ✓; precio real sin cambiar (60€) ✓; lectura autenticada de profiles sin recursión ✓; fuga anónima sigue cerrada ✓. Build ✓. Tests de lógica 51/51 ✓.
  - **Pendiente producción (fase final):** aplicar migraciones 20260713000000 (corregida) y 20260713000001.

- **Paso 3** 🟡 (en curso, 2 de 3 sub-partes hechas):
  - ✅ **Guard palmeras (CRÍTICO):** bookingQuoteCore.ts — `hasTreeOrPalm` ahora detecta por payload (palmGroups/treeGroups) en vez de substrings de UUIDs. Palmeras per_hour vuelven a usar el motor detallado (extras). Test de regresión añadido (palmeras per_hour = 50€ engine, no 30€ ingenuo). 357 tests verdes.
  - ✅ **Herbicida en fito (ALTO):** decisión del usuario = quitarlo de fito (lo cubre Desbroce). Eliminado el grupo 'Control de Malas Hierbas' de PHYTOSANITARY_GROUPED_FIELDS (DetailsPage), la rama 'herbi'→'herbicida' del mapeo (DetailsPage:2330) y los campos herbicida_*_densidad_m2 del prompt (new_prompts.ts). Referencias de tipo/manejo defensivo quedan inertes (código muerto menor → paso 11). **Pendiente producción:** redesplegar ai-pricing-estimator (prompt).
  - ⏳ **Fito manual vs IA (ALTO):** PENDIENTE. Es un refactor profundo del motor de fito (dos modelos de precio distintos: rama sin métricas suma tarifa fija por tratamiento con insecticida→curativo y palmeras/árboles>3m→banda mediana; rama con métricas usa tarifa única preventivo/curativo + combo). Matiz de producto: el wizard manual no pregunta la banda de altura exacta. Merece la skill garser-manual-entry como SSOT + tests de paridad exhaustivos. NO abordado para no introducir bugs de precio peores.
  - **Pendiente producción (fase final):** redesplegar booking-authority + booking-payment (tocan bookingQuoteCore) y ai-pricing-estimator (prompt).

- **Paso 4** ✅ (local/código, pendiente de desplegar y probar en producción) — captura diferida:
  - booking-payment: PaymentIntent con `capture_method='manual'` (autoriza) + acción `finalize_booking_payment` (captura al aceptar / libera al rechazar, idempotente vía stripeGet del estado real) + helper getAttemptByBookingId.
  - booking-payment-webhook: la reserva se crea en `payment_intent.amount_capturable_updated` (autorización); `succeeded` es idempotente (confirm_booking_payment_attempt no valida captura, solo importe).
  - bookingRequestService: al aceptar/rechazar invoca finalize_booking_payment.
  - Expiración 24h: cubierta por auto-release de Stripe a 7 días; liberación explícita = mejora futura.
  - 357 tests + build verdes. **Despliegue:** redesplegar booking-payment + webhook, subir front, y AÑADIR el evento `payment_intent.amount_capturable_updated` al webhook en Stripe.

- **Paso 4 (captura diferida)** ✅ CÓDIGO YA IMPLEMENTADO (commit 34dd714, no escrito en esta sesión — trabajo previo/paralelo del usuario). Flujo completo y cableado:
  - booking-payment: PaymentIntent con `capture_method: 'manual'` (autoriza, no cobra); endpoint `finalize_booking_payment` que captura (accept) o libera (reject) según el estado.
  - booking-payment-webhook: crea la reserva en `payment_intent.amount_capturable_updated` (al autorizar), no al capturar; idempotente.
  - bookingRequestService: tras responder, invoca finalize_booking_payment (captura/libera). Fallo no bloquea (Stripe libera a 7 días).
  - Webhook de Stripe: evento `amount_capturable_updated` añadido por el usuario (modo test). ✓
  - 357 tests verdes, build ok, en el PR #8.
  - **Pendiente:** redesplegar booking-payment + booking-payment-webhook con --use-api; prueba E2E en Stripe test.
  - **Mejora opcional (no crítica):** liberar el PI al EXPIRAR la solicitud (24h) en vez de esperar la caducidad de 7 días de Stripe. Hoy el finalize solo corre al responder, no al expirar.

- **Paso 5 (robustez webhook)** ✅ commit bdbc882: reprocesa eventos Stripe atascados en 'processing' >3min (idempotente); vía broadcast verificada como código latente (no explotable). **Pendiente:** redesplegar booking-payment-webhook.
- **Paso 6 (fiabilidad emails)** ✅ (núcleo ya activo tras redeploy del webhook en paso 4):
  - CTA rota del email de rechazo de jardinero: `/gardener/apply` y `/aplicar` → `/apply` (ApplicationsAdmin + send-email-notification).
  - Email de cancelación cableado: `notifyClientOfCancellation` (booking_cancelled, estaba implementado pero nunca se invocaba) se dispara cuando el jardinero cancela una reserva CONFIRMADA (GardenerDashboard).
  - 357 tests + build verdes. **Pendiente:** redesplegar send-email-notification; deploy front (Vercel).
  - **Pendientes anotados:** (a) mover email de aceptar/rechazar a server-side (hoy fire-and-forget desde el front del jardinero); (b) REEMBOLSO al cancelar una reserva confirmada ya cobrada (el email avisa pero no reembolsa) → paso 8; (c) email de solicitud expirada; (d) seguridad de send-email-notification (validar llamante) → paso 9.

- **Paso 7 (reseñas visibles)** ✅ commit 2849187 — migración `20260729120000_sync_gardener_rating_aggregates.sql`: trigger SECURITY DEFINER sobre `reviews` que sincroniza los 4 campos (rating_average/rating_count que lee ProvidersPage + rating/total_reviews del perfil público) en INSERT/UPDATE/DELETE, con backfill. Eliminado el recálculo client-side (fallaba por RLS: un cliente no puede escribir en el perfil de otro). Perfil público ya no finge 5.0 sin reseñas. Verificado en local con datos reales. **Pendiente:** `supabase db push` + deploy front.
- **Diagnóstico emails (3 capas de fallo silencioso)** ✅ resuelto: (1) gateway 401 por verify_jwt en booking-confirmation-email; (2) error de invoke no comprobado en el webhook; (3) **SMTP_USER = mjgardenproject@gmail.com mientras el único remitente verificado en Brevo es info@garser.es** → Brevo rechazaba todo sin dejar rastro. Añadido console.error en los envíos fallidos. **Pendiente usuario:** `supabase secrets set SMTP_USER=info@garser.es EMAIL_FROM=info@garser.es` + desactivar restricción por IP en Brevo (las IPs del edge runtime cambian).

- **Paso 8 (claridad de precios cliente/jardinero)** ✅ — el cliente veía "Total 177,75 €" en el checkout y "Total 158,00 €" en el email y la tarjeta, sin saber si los 19,75 € ya pagados salían de esos 158.
  - **Causa raíz:** la comisión no existía como columna; vivía en el jsonb `pricing_context`. Y **no es derivable** de `total_price * 0,125`, porque `respond_booking_price_change` sobrescribe `total_price` sin recobrar comisión. Nueva columna `bookings.management_fee` (+ `management_fee_source`, + generada `client_total_price`), inmutable por trigger, con backfill en cascada desde `booking_payment_attempts` → `pricing_context`. Sin fallback al 12,5 %: si no consta, la UI oculta el desglose en vez de inventar una cifra.
  - SSOT `src/shared/bookingAmounts.ts` (cero imports, compartido con las edge functions Deno) + `public.format_eur()`: un único formato de euro en React, Deno y SQL (antes convivían tres).
  - Cliente: *Total de la reserva* + *Pendiente de pagar al profesional* en checkout, tarjeta, chat y emails, distinguiendo gastos **retenidos** (pendiente) de **cobrados** (confirmada). Jardinero: solo *Cobrarás*, íntegro. Admin: separados volumen transaccionado e ingresos GarSer (antes "Ingresos Totales" sumaba el bruto del jardinero, canceladas incluidas).
  - **Cierra los pendientes (a) y (d) del paso 6:** los emails de aceptar/rechazar/cancelar ya no llevan el precio compuesto en el navegador (solo `bookingId`), y `send-email-notification` valida al llamante (participante de la reserva o admin) y ya no acepta destinatario libre — era un relay de correo con la marca GarSer.
  - **Bugs graves encontrados de paso:** (1) las 6 migraciones de cambio de precio eran SECURITY INVOKER → `permission denied` desde el hardening del 12/07: proponer/aceptar un cambio de precio no funcionaba; (2) aceptar un cambio de precio confirmaba la reserva pero **nunca capturaba el pago** (autorización caducada a 7 días = comisión perdida en silencio) → nueva acción `finalize_price_change_payment`.
  - Código muerto retirado: `TreePruningQuoteDisplay`, `bookingBroadcastService`, `bookingAtomicService`, `createBroadcastBookingRequests` (+ tests) y RPC de creación huérfanas revocadas. Retirado `getBookingCustomerPaymentSummary`, cuyos campos `reservationFee`/`confirmationDeposit` eran el mismo importe con dos nombres.
  - 376 tests + build verdes. Migraciones ejecutadas contra Postgres 18 real vía PGlite (Docker caído) — ahí se detectó y corrigió un `UPDATE ... FROM LATERAL` inválido en el backfill.
  - **Pendiente:** `supabase db push`; redesplegar `booking-payment`, `booking-confirmation-email` y `send-email-notification` con `--use-api`; deploy front. Tras la ventana de despliegue, **retirar la rama legacy** de `send-email-notification`. Sigue abierto el reembolso al cancelar (b).

### ✅ Regresión de entorno de test RESUELTA
`brew upgrade supabase` arrastró Node a v26.5.0, incompatible con jsdom 29 → 24 tests de UI fallaban. **Resuelto:** `brew install node@22` + `brew link --overwrite --force node@22` → Node 22.23.1 LTS activo. Suite completa **356/356 en verde**, build ✓. Añadido `.nvmrc` con `22`.

## ✅ AUDITORÍA COMPLETA
Las 7 dimensiones estáticas entregadas + web viva + informe maestro `REPORT.md` con veredicto **NO-GO** (5 bloqueantes acotados). Nada de código modificado. Entregables: `00-app-map.md`, `01-static-findings.md`, `02-live-findings.md`, `REPORT.md`.


## Hecho ✅
- **Paso 0** — Playbooks leídos, alcance fijado (todas las dimensiones, web viva local, SIN aplicar fixes; entregable = informe).
- **Paso 1** — Mapa de la app completo → `00-app-map.md` (rutas, edge functions, tablas/RLS/storage, toolchain).
- **Verificaciones del orquestador** (ya en 00-app-map.md):
  - Build ✅, tests 356/356 ✅, lint 3 errores triviales + 816 warnings.
  - **CRÍTICO verificado:** tabla `profiles` (full_name, phone, address) legible por `anon` — política `USING(true)` + GRANT en 20250929000001_anonymous_booking_access.sql:89-117, nunca revocada.
  - **CRÍTICO verificado:** `booking-payment-webhook` desplegado v10 (25-may) es anterior a la integración de emails (21-jun) y a fixes posteriores → los emails de confirmación de pago NO se disparan en producción. `booking-telemetry` también obsoleto (desplegado 20-may < commit 30-may). `booking-payment`/`booking-complete`/emails: ambiguos por horas (patrón deploy-antes-de-commit) → redesplegar TODO con `--use-api`.
  - Función fantasma `email-otp` desplegada (dic-2025) que no existe en el repo.
- **Paso 2 parcial** — Dimensiones completadas: **Dim 2 (basura)** y **Dim 6 (emails)** → hallazgos en `01-static-findings.md`.

## En curso ⏳
- **Dim 1 (negocio/paridad precios), Dim 3 (seguridad), Dim 4 (flujos), Dim 5 (datos/pagos), Dim 7 (features)**: subagentes reanudados tras límite de sesión (2ª vez). Si vuelven a caer, reanudarlos con SendMessage (conservan contexto).
- **Paso 3 (web en vivo)**: servidor dev arrancado (garser-dev, puerto 5173, preview). Home móvil auditada: OK visual, sin errores consola, sin overflow horizontal; copy sin tildes ("jardineria", "jardin"). Falta: resto de home, funnel completo 7 servicios (IA + manual), auth, jardinero, admin, área cliente, viewports 768/1440.

## Pendiente ⬜
- Consolidar Paso 4: `REPORT.md` (inventario maestro por severidad + go/no-go + checklist de lanzamiento).
- Pendientes manuales del usuario a incluir en go/no-go: plantillas Auth email (pendiente), imágenes services (vienen de BD `services.image_url` + tabla `service_images`; public/ solo tiene favicon — verificar en vivo), restricciones API key Maps (no verificable desde repo), E2E Stripe real (pendiente), verificación `supabase secrets list` (SMTP_USER/SMTP_PASS — modo MOCK devuelve success sin enviar).
- NO se aplica ningún fix en esta sesión (decisión del usuario).
