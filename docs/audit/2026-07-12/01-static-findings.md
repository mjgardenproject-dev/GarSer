# Hallazgos estáticos (consolidación en curso)

Dimensiones completadas: **orquestador (verificaciones propias), Dim 2 (basura), Dim 6 (emails)**.
Pendientes de recibir: Dim 1 (negocio), Dim 3 (seguridad), Dim 4 (flujos), Dim 5 (datos), Dim 7 (features).

---

## Verificados por el orquestador

### [CRÍTICO] Tabla `profiles` con PII legible por usuarios anónimos
- **Dimensión:** 3 Seguridad (verificado directamente en migraciones)
- **Archivo:** supabase/migrations/20250929000001_anonymous_booking_access.sql:89-96 y :117
- **Problema:** Política "Allow anonymous users to view profiles" `FOR SELECT USING(true)` + `GRANT SELECT ON profiles TO anon`, nunca revocados por migraciones posteriores (verificado). `profiles` contiene full_name, phone, address, avatar_url.
- **Impacto:** Cualquiera con la anon key (pública por definición, está en el bundle) puede volcar nombre, teléfono y dirección de TODOS los usuarios vía REST. Fuga de PII masiva + incumplimiento RGPD.
- **Fix:** Migración que dropee ambas policies SELECT `USING(true)` de profiles y revoque el GRANT a anon; dejar SELECT solo a dueño + admin (+ si el funnel necesita el nombre del jardinero, exponerlo vía `gardener_profiles` o una vista con columnas mínimas).
- **Esfuerzo:** S

### [CRÍTICO] Edge functions desplegadas obsoletas: los emails de reserva no se disparan en producción
- **Dimensión:** 6 Emails / infraestructura
- **Archivo:** supabase/functions/booking-payment-webhook/index.ts:620 (código correcto local)
- **Problema:** El webhook desplegado es v10 (2026-05-25), anterior a la integración de emails (a4dd248, 21-jun) y al fix f2a6955 (30-may). `booking-telemetry` desplegado 20-may < último commit 30-may. `booking-payment` (deploy 03-jun 14:44 vs commit 19:19) y `booking-complete` (deploy 18-may 16:06 vs commit 19:46) ambiguos.
- **Impacto:** Ni cliente ni jardinero reciben email al pagar una reserva. Además producción corre sin los últimos fixes del webhook.
- **Fix:** Redesplegar TODAS las funciones con `supabase functions deploy <n> --use-api` (Docker cuelga en esta máquina) y verificar invocaciones en logs.
- **Esfuerzo:** S

### [MEDIO] Función fantasma `email-otp` desplegada en producción sin código en el repo
- **Archivo:** producción Supabase (v29, dic-2025); no existe supabase/functions/email-otp
- **Problema:** Función activa en producción cuyo código no está bajo control de versiones y a la que nadie del front llama.
- **Fix:** Revisar su contenido en el dashboard y borrarla de producción si está muerta.
- **Esfuerzo:** S

### [MEDIO] Bundle único de 1,43 MB (376 kB gzip) sin code-splitting
- **Archivo:** vite.config.ts / dist
- **Problema:** Toda la app (admin, jardinero, debug, funnel) va en un solo chunk. En móvil 4G el primer paint del funnel paga el peso del panel admin.
- **Impacto:** Conversión (velocidad de carga en móvil, el caso principal).
- **Fix:** `React.lazy` por rutas grandes (admin, jardinero, debug) o manualChunks.
- **Esfuerzo:** M

### [BAJO] Lint: 3 errores
- ApplicationsAdmin.tsx:97,132 (`@ts-ignore` → `@ts-expect-error`), ProvidersPage.tsx:402 (prefer-const). 816 warnings (mayoría unused-vars).

---

## Dim 2 — Código basura / muerto (subagente, completo)

### [ALTO] Herramienta de debug "DatabaseFix" montada en el panel admin de producción
- **Archivo:** src/components/debug/DatabaseFix.tsx (renderizada en ApplicationsAdmin.tsx:569, montada vía UserManagement.tsx:13) + src/utils/databaseFix.ts
- **Problema:** Se renderiza incondicionalmente en el admin; hace INSERTs de prueba reales contra availability_blocks y role_logs desde el navegador. Confirmado en bundle de producción.
- **Fix:** Quitar `<DatabaseFix />` y borrar componente + util (o gate `import.meta.env.DEV` + lazy).
- **Esfuerzo:** S

### [ALTO] console.log con PII llegan al bundle de producción (70 en dist)
- **Archivo:** AuthForm.tsx:242 (email del usuario en reset), AdminRoute.tsx:79,106 (userId+email+rol), GardenerDashboard.tsx:47 (8 logs), AuthContext.tsx (11), AddressAutocomplete.tsx (11 — imprime lo que teclea el cliente), availabilityServiceCompat.ts (6), roleLogger.ts (5), etc.
- **Problema:** 70 console.log en dist; emails y entradas de usuario visibles en DevTools. Checkout/DetailsPage/ProvidersPage/BookingContext limpios (0).
- **Fix:** Borrar logs con PII y añadir `drop: ['console']`/pure en vite.config.ts.
- **Esfuerzo:** S-M

### [MEDIO] Rutas de debug montadas y su código en el bundle
- **Archivo:** src/App.tsx:455-480 (imports estáticos líneas 10,23,25,26); DevelopmentRoute.tsx:21-24
- **Problema:** /debug-maps y /debug-roles gateadas por DEV+localhost PERO con bypass por env `VITE_ENABLE_DEBUG_ROUTES=true`; una env mal puesta en Vercel las reabre. RoleDebug puede CREAR perfiles en BD (RoleDebug.tsx:148-183). Código en bundle por import estático.
- **Fix:** Eliminar rutas debug e imports (o lazy + gate solo DEV sin bypass env).
- **Esfuerzo:** S

### [MEDIO] ~25 archivos sueltos en raíz; solo 3 se usan
- Referenciados por package.json: create_booking_photos_bucket.js, enforce_canonical_services.js, loadSupabaseAdminEnv.js. El resto (apply_*, check_*, debug-*, fix_*, diagnose_*, link_*, recurring_setup, test-*, get-gardeners, investigate_duplicates) = basura.
- **Fix:** Borrar lote (lista completa al final); mover los 3 vivos a scripts/.

### [MEDIO] Script npm roto `seed:services` → seed_services.js no existe
- **Archivo:** package.json:12. **Fix:** eliminar o reapuntar a enforce_canonical_services.js.

### [MEDIO] SQL de raíz con policies de storage posiblemente nunca migradas
- **Archivo:** supabase_policies.sql:49-64 (bucket `flyers`), setup_images_bucket.sql + create_bucket_folders.sql (bucket `images`)
- **Problema:** Esas policies/buckets no existen en ninguna migración; src ya no referencia flyers/images. Si los buckets existen en producción, sus policies viven fuera de las migraciones.
- **Fix:** Verificar en dashboard; si no existen, borrar los .sql; si sí, portar a migración.

### [MEDIO] Cadena muerta TreePruning + carpeta src/services/ huérfana
- **Archivo:** TreePruningDetails/QuoteDisplay/Booking.tsx, src/services/aiTreeAnalysisService.ts; import comentado DetailsPage.tsx:112-113
- **Problema:** 0 importadores reales; tree-shaken del bundle. El flujo real de árboles vive en DetailsPage + analysisV2.
- **Fix:** Borrar los 4 archivos + imports comentados.

### [MEDIO] dogfood-output/ (~25 PNGs) + DOGFOODING_REPORT.md + debug-*.md + spec_*.md trackeados
- **Fix:** Borrar artefactos caducados; mover spec_*.md a docs/; gitignore dogfood-output/.

### [BAJO] Huérfanos: roleLogger.ts, ServiceCatalog.tsx, useServiceData.ts (+carpeta hooks/booking)
### [BAJO] Duplicación imageCompression.ts vs imageCompressor.ts (dos compressImage vivos)
### [BAJO] Claves anon+ref hardcodeadas en check_missing_tables.js:4 y get-gardeners.js:3 (anon, no service_role — higiene)
### [BAJO] Cadena disponibilidad client-side: borrada de src ✅; restos en ARCHITECTURE.md/PATTERNS.md (describen arquitectura que ya no existe); availabilityServiceCompat.ts vivo (capa conversión availability↔availability_blocks del lado jardinero, 6 console.log)
### [BAJO] 9 directorios vacíos (api/, src/test/, src/schemas/, src/components/seo/, etc.)

**Positivo:** sin .bak/temp; 1 TODO en src; checkout limpio de logs; .env fuera de git.

---

## Dim 6 — Emails y notificaciones (subagente, completo)

### Matriz evento → email (resumen)
- Pago confirmado → email dual cliente+jardinero desde webhook: código OK, **NO se dispara en producción** (webhook obsoleto → CRÍTICO arriba).
- Jardinero acepta/rechaza → email al cliente desde el NAVEGADOR del jardinero, fire-and-forget, errores tragados (ALTO).
- Cancelación de reserva confirmada → **ningún email** (tipo booking_cancelled implementado pero nunca invocado — código muerto) (ALTO).
- Solicitud expirada → **ningún email** pese a que el copy del email promete avisar (MEDIO).
- Recordatorio previo / servicio completado / petición de reseña → no existen (BAJO).
- Registro/reset → Supabase Auth (plantillas default; personalización pendiente conocida).
- Notificaciones in-app: **no existen** (ni tabla ni campanita; los avisos reales son mensajes de chat).
- Proveedor: Brevo API (secrets SMTP_USER/SMTP_PASS); plantilla de marca HTML+text/plain escapada, enlaces a garser.es.

### [ALTO] booking_accepted/rejected disparado desde el navegador del jardinero; fallos 100% invisibles
- **Archivo:** src/utils/bookingRequestService.ts:136 (`void notifyClientOfResponse`), :89-101
- **Problema:** (1) si el jardinero cierra la pestaña tras aceptar, el email se pierde (el cambio de estado es RPC server-side, el email no); (2) functions.invoke no lanza en errores HTTP y `{error}` no se comprueba → el catch/telemetría nunca saltan.
- **Fix:** Mover dispatch a server-side; mínimo: comprobar `{ error }`.
- **Esfuerzo:** M

### [ALTO] Cancelar reserva confirmada no envía email; booking_cancelled muerto
- **Archivo:** GardenerDashboard.tsx:196-199; send-email-notification/index.ts:130
- **Fix:** Invocar booking_cancelled server-side en la transición confirmed→cancelled.
- **Esfuerzo:** M

### [MEDIO] Solicitud expirada sin aviso al cliente (promesa del copy incumplida)
- **Archivo:** 20260514090000_booking_request_lifecycle_rpc.sql; booking-confirmation-email/index.ts:176
- **Fix:** Disparar email booking_expired desde el cron/RPC de expiración.

### [MEDIO] CTA "Volver a solicitar" del email de rechazo apunta a rutas inexistentes
- **Archivo:** ApplicationsAdmin.tsx:62 (`/gardener/apply` + window.location.origin → riesgo enlace localhost) y send-email-notification/index.ts:105 (`/aplicar`)
- **Problema:** La ruta real es `/apply`. **Fix:** `${BRAND.site}/apply` en ambos.
- **Esfuerzo:** S

### [MEDIO] Fallo del dispatch de email en el webhook silencioso + posible 401 por verify_jwt
- **Archivo:** booking-payment-webhook/index.ts:619-626; supabase/config.toml (sin entrada booking-confirmation-email)
- **Problema:** `{error}` de admin.functions.invoke ignorado; booking-confirmation-email se despliega con verify_jwt=true — si el proyecto usa claves modernas sb_secret_ (no JWT), el gateway rechaza con 401 sin rastro.
- **Fix:** Comprobar `{error}` + configurar verify_jwt/secreto interno.
- **Esfuerzo:** S

### [MEDIO] Modo MOCK devuelve success:true — sin secrets SMTP "todo funciona" sin enviar nada
- **Archivo:** send-email-notification/index.ts:148-153; booking-confirmation-email/index.ts:87,149-152
- **Fix:** Verificar `supabase secrets list` (SMTP_USER remitente @garser.es verificado en Brevo) + envío de prueba real. **Pendiente manual del usuario.**

### [MEDIO] Cualquier usuario autenticado puede enviar emails de marca GarSer a cualquier destinatario
- **Archivo:** send-email-notification/index.ts:53-75
- **Problema:** Acepta `to`/`user_id` arbitrarios y campos de texto libre con JWT de usuario normal → vector spam/phishing con plantilla oficial.
- **Fix:** Validar rol/relación server-side; resolver datos de reserva en servidor.
- **Esfuerzo:** M

### [BAJO] Sin recordatorio previo ni email post-servicio (gancho de reseñas)
### [BAJO] El jardinero ve en su email el total del cliente (con comisión), no su neto — booking-confirmation-email/index.ts:112,132-137
### [BAJO] Fecha ISO cruda en email de aceptación (bookingRequestService.ts:85-87) vs formatBookingDate en el resto
### [BAJO] Migración vacía 0 bytes 20260528124257_task6_booking_confirmation_email_dispatcher.sql

---

## Dim 5 — Datos y ciclo de pago Stripe (subagente, completo)

**Camino feliz (funciona):** PaymentIntent + Stripe Elements embebido. booking-authority firma presupuesto en booking_quotes; booking-payment revalida y crea booking_payment_attempts + hold de agenda (30 min); PaymentIntent con Idempotency-Key; la fila bookings se crea DESPUÉS del cobro en confirm_booking_payment_attempt (idempotente, revalida importe/hold/disponibilidad). Idempotencia de webhook vía stripe_webhook_events (PK stripe_event_id) + firma HMAC (tolerancia 300s). Race de slots protegida por UNIQUE(gardener_id,date,hour_block) + FOR UPDATE. **Modelo: Stripe cobra SOLO la comisión 12,5% (gastos de gestión); el jardinero cobra el 100% del servicio fuera de plataforma. No hay Stripe Connect.**

### [CRÍTICO] No existe ninguna ruta de reembolso en todo el repo; el cliente paga la comisión antes de que el jardinero acepte
- **Archivo:** 20260526164950_booking_payment_availability_dedup_fix.sql:636 (booking nace pending); 20260514090000_booking_request_lifecycle_rpc.sql:118-148 (expira a 24h→expired) y :250-262 (reject→cancelled). **Verificado por el orquestador: `grep refund` en supabase/+src/ = 0 resultados.**
- **Problema:** Tras cobrar la comisión, la reserva espera aceptación del jardinero. Si rechaza o no responde en 24h, pasa a cancelled/expired con el cargo YA capturado y sin reembolso automático (no hay una sola llamada a /v1/refunds).
- **Impacto:** El cliente paga gastos de gestión por un servicio que nunca se presta y no recupera el dinero. Contracargo/queja garantizada con dinero real. **Bloqueante de producción.**
- **Fix:** Emitir refund del PaymentIntent (guardado en pricing_context.payment_intent_id) al cancelar/expirar por causa no imputable al cliente; o capture_method:manual y capturar solo al aceptar el jardinero.
- **Esfuerzo:** M

### [CRÍTICO] Pago capturado sin reserva (INSERT falla) queda en reconciliation_required sin reembolso ni alerta
- **Archivo:** 20260526164950_...sql:612-733 (INSERT bookings ... EXCEPTION → release_booking_payment_attempt('reconciliation_required'))
- **Problema:** Si Stripe reporta succeeded pero el INSERT de bookings/booking_blocks falla (o disponibilidad/hold ya no cuadran), el intento pasa a reconciliation_required con el dinero cobrado, sin refund ni alerta operativa, solo telemetría. Resolución 100% manual sin nadie mirando.
- **Impacto:** Dinero cobrado sin reserva retenido indefinidamente. **Bloqueante.**
- **Fix:** En cada rama a reconciliation_required con pago capturado, emitir refund automático o marcar+notificar. Distinguir "reconciliación con dinero" de "sin capturar".
- **Esfuerzo:** M

### [ALTO] Fila del ledger de webhook atascada en `processing` bloquea el reprocesamiento para siempre
- **Archivo:** booking-payment-webhook/index.ts:394-455, esp. :448-454
- **Problema:** El primer intento inserta la fila con status='processing'. Si ese procesamiento muere a mitad (timeout/crash), queda en processing; en las reentregas de Stripe, upsertWebhookLedgerRow trata processing como alreadyProcessed → responde duplicate sin reprocesar. Solo reintenta si quedó en failed. Un payment_intent.succeeded así nunca crea la reserva pese a haber cobrado.
- **Fix:** No tratar processing como terminal: reprocesar si supera umbral (2-5 min), apoyándose en la idempotencia de confirm_booking_payment_attempt.
- **Esfuerzo:** M

### [ALTO] Dos vías de creación de reservas; la vía broadcast crea bookings sin pago (confirmed alcanzable sin PaymentIntent)
- **Archivo:** 20260514090000_...sql:152+ (respond_booking_request / create_broadcast_booking_requests) vs vía pago 20260526164950_...sql:612
- **Problema:** Dos caminos insertan bookings en pending: la vía Stripe (con pago) y create_broadcast_booking_requests (sin pago). Indistinguibles por status; respond_booking_request no comprueba pago → confirmed alcanzable sin PaymentIntent. Verificar si la vía broadcast sigue viva.
- **Fix:** Si está muerta, retirarla del funnel; si viva, añadir flag de origen/estado de pago y validarlo en la aceptación.
- **Esfuerzo:** M (verificación) / L (unificar)

### [MEDIO] GardenerDashboard: insert de chat sin comprobar error + catch de updateBookingStatus solo console.error (sin toast)
- **Archivo:** GardenerDashboard.tsx:214-222 y :227-229. El jardinero cree que confirmó/canceló cuando pudo fallar.
### [MEDIO] booking-complete marca completed aunque falle la limpieza de fotos → objetos huérfanos en Storage sin reintento — booking-complete/index.ts:126-207
### [MEDIO] Fotos subidas quedan huérfanas si el cliente abandona antes de completar (limpieza solo en booking-complete; sin barrido por antigüedad) — bookingPhotoPipeline.ts/bookingMediaService.ts
### [MEDIO] Sin política de reembolso/cancelación por parte del cliente (transversal, BookingsList.tsx)
### [BAJO] Doble submit de pagar: protegido (lock+idempotency+clientSecret) — documentado como correcto
### [BAJO] total_price guarda el total del servicio; el importe cobrado (12,5%) solo vive en pricing_context, no como columna de bookings (trazabilidad contable)
### [BAJO] AuthContext upsert con ignoreDuplicates sin comprobar error — AuthContext.tsx:185

**Estados de reserva:** pending|confirmed|in_progress|completed|cancelled|expired. **in_progress es inalcanzable** (ningún writer; el dashboard salta pending→confirmed→completed).

---

## Dim 4 — Flujos desconectados (subagente, completo)

### [ALTO] Botones "volver a elegir horario" inertes en la ruta /reserva/confirmacion (aterrizaje del retorno de Stripe)
- **Archivo:** App.tsx:358-367 (la ruta monta ConfirmationPage directa, no BookingFlow) + ConfirmationPage.tsx:1241 (goBackToSlotSelection=setCurrentStep(3)), :1656/:1263/:1294/:1430/:1449
- **Problema:** /reserva/confirmacion renderiza ConfirmationPage siempre, sea cual sea currentStep. "Cambiar horario"/"Elegir otro horario" solo hacen setCurrentStep(3) sin navigate → no pasa nada. A esa ruta se llega en el return_url de Stripe (bookingPaymentCore.ts:200) y en el redirect del email de auth (ConfirmationPage.tsx:879).
- **Impacto:** Cliente que vuelve de un 3DS fallido o con hold caducado pulsa "Elegir otro horario" y no ocurre nada; no puede recuperar la reserva. (En el camino feliz dentro de /reservar como paso 4 sí funciona.)
- **Fix:** Detectar montaje fuera de BookingFlow y navigate('/reservar'), o montar BookingFlow en esa ruta.
- **Esfuerzo:** S

### [MEDIO] No hay ruta catch-all 404: URL desconocida deja main vacío (pantalla en blanco) — App.tsx:246-502. Fix: Route path="*".
### [MEDIO] Retorno de pago pierde la sync automática si quoteId no sobrevive al redirect (efecto guardado por bookingData.quoteId aunque attempt_id sí viaja) — ConfirmationPage.tsx:1015-1016. Fix: arrancar el efecto por attemptId.
### [MEDIO] Estado in_progress huérfano: la UI lo etiqueta (4 componentes) pero ningún writer lo escribe — types/index.ts:160
### [BAJO] Cliente sin acción de cancelar pero la UI ofrece filtro "Cancelado" — BookingsList.tsx:231
### [BAJO] Segunda Route path="/" inalcanzable — App.tsx:499
### [BAJO] BookingCheckoutPage.tsx huérfano (reexport de 1 línea) — src/pages/reserva/checkout/
### [BAJO] Bypass de rol admin en DEV para /role-monitor (nulo en prod) — AdminRoute.tsx:70-74

**Verificado sano:** funnel paso a paso persiste y avanza; no hay deep-links rompibles (el paso vive en currentStep, no en URL); refresh preserva estado (BookingContext auto-guarda + loadProgress + bookingDraftPhotoCache); chat con backend real (Realtime, paginación, cursores, propuestas de precio); cadena de disponibilidad muerta = 0 hits (SSOT = booking-authority); redirects legacy correctos.

---

## Dim 7 — Features sin terminar o rotas (subagente, completo)

### [CRÍTICO] Las reseñas nunca llegan a la pantalla de elección de jardinero (columnas desalineadas) → todos salen "Nuevo"
- **Archivo:** BookingsList.tsx:177-180 (escribe gardener_profiles.rating y total_reviews) vs ProvidersPage.tsx:398,805-806 (lee rating_average y rating_count, columnas distintas creadas con DEFAULT 0 que NADIE actualiza — migración 20251229000000)
- **Problema:** Por muchas reseñas 5★ que reciba un jardinero, en el escaparate de elección siempre aparece "Nuevo". El sistema de reviews existe (tabla reviews+RLS, UI media-estrella, flujo post-servicio) pero su salida se pierde en el punto de conversión clave.
- **Impacto:** El marketplace nunca muestra reputación real al comprar. Prueba social rota justo donde más convierte.
- **Fix:** Unificar a un único par de columnas (idealmente trigger SQL sobre reviews + backfill). Verificar consistencia con GardenerPublicProfile.tsx:80 (lee rating/total_reviews, sí funciona).
- **Esfuerzo:** S (alinear) / M (trigger+backfill)

### [ALTO] El cliente no puede cancelar ni reprogramar una reserva (solo pintado el ciclo del jardinero) — BookingsList.tsx:359-378. Solo Chat y Valorar; ninguna vía a cancelled desde el cliente.
### [ALTO] ServiceDetail muestra rating fijo inventado "4.8 (127 reseñas)" — ServiceDetail.tsx:107 (ruta /service/:serviceId accesible por URL; ServiceCatalog que la enlaza es código muerto). Fix: eliminar ruta+componentes o datos reales.
### [MEDIO] Imágenes de servicios: primario y "fallback" apuntan al MISMO path de Storage vacío (marketing-assets) → todo degrada a gris — ServicesPage.tsx:197-198 + serviceImages.ts:29-44 + marketingAssets.ts:8-13. **Pendiente manual: subir 7 webp a bucket marketing-assets.** (Confirmado en vivo: net::ERR_BLOCKED_BY_ORB en lawn/weeding/trees/palms/plants/phyto.webp.)
### [BAJO] Admin "Ingresos Totales" suma total_price bruto (GMV), no la comisión 12,5% — AdminDashboard.tsx:44-51,78 (etiqueta engañosa)
### [BAJO] Perfil público jardinero muestra "5.0 (0 reseñas)" por defecto — GardenerPublicProfile.tsx:80
### [BAJO] TODO real en pipeline IA césped: photoUrls asigna todas las URLs a cada zona — DetailsPage.tsx:2167 (no afecta precio)

**Verificado sano:** /admin/settings ya NO está "en construcción" (form real a app_settings); chat completo; disponibilidad del jardinero real (AvailabilityManager→setGardenerAvailability sobre tabla availability + recurrentes); activación servicios/tarifas persiste (gardener_service_prices upsert); admin (users/services/phytosanitary/dashboard) operativo; MyAccount funcional. ServiceCatalog.tsx y ServiceDetail.tsx = código muerto.

---

## Dim 3 — Seguridad (subagente, completo)

**Nota transversal clave:** en Supabase `verify_jwt=true` solo exige *un* JWT válido del proyecto, y **la anon key es un JWT válido y público** (va en el bundle). Por tanto verify_jwt=true NO restringe a usuarios logueados: cualquiera en Internet con la anon key puede invocar la función. Las funciones sin comprobación interna de auth son de facto públicas.

### [CRÍTICO] Tabla `profiles` legible por anon — fuga de PII (nombre, teléfono, dirección)
- **Archivo:** 20250929000001_anonymous_booking_access.sql:89-96,113-117 (columnas en dawn_castle.sql:19-29)
- **Problema:** Policy SELECT USING(true) + GRANT SELECT TO anon, nunca revocados (solo se revocaron los de bookings).
- **Impacto:** Cualquiera con la anon key puede volcar full_name/phone/address de TODOS los usuarios vía PostgREST. RGPD. **Bloqueante.**
- **Fix:** DROP POLICY + REVOKE SELECT FROM anon; exponer datos públicos del jardinero por vista con columnas mínimas.
- **Esfuerzo:** S

### [CRÍTICO] `gardener_profiles` legible por anon con teléfono, dirección y coordenadas operativas
- **Archivo:** 20250929000001_anonymous_booking_access.sql:23-30,114 (columnas dawn_castle.sql:43-58)
- **Problema:** Mismo patrón USING(true)+GRANT nunca revocado; incluye phone/address/operational_latitude/longitude.
- **Impacto:** Volcado anónimo de teléfono, dirección y coordenadas exactas de todos los jardineros. **Bloqueante.**
- **Fix:** Revocar SELECT anónimo; vista pública sin phone/address/coords exactas.
- **Esfuerzo:** S

### [ALTO] `send-email-notification` sin verificación del llamante — relay de correo abusable
- **Archivo:** send-email-notification/index.ts:47-76
- **Problema:** No comprueba apikey allowlist ni que el llamante sea dueño de to/user_id; acepta `to` arbitrario y envía email de marca GarSer vía Brevo, sin rate limit.
- **Impacto:** Cualquiera envía correos oficiales GarSer a direcciones arbitrarias (phishing/spam) quemando reputación de envío y cuota; enumeración de usuarios por user_id.
- **Fix:** Exigir JWT real + validar propiedad, o restringir a service_role; rate limit.
- **Esfuerzo:** M

### [ALTO] `ai-pricing-estimator` sin auth de usuario ni rate limit — abuso de coste Gemini + SSRF por photo_urls
- **Archivo:** ai-pricing-estimator/index.ts:1083-1097 (entrada) y :887-908 (fetchImageAsBase64)
- **Problema:** No valida apikey ni usuario ni límites; fetchImageAsBase64 hace fetch() de cualquier URL de photo_urls/hedge_faces sin allowlist de host.
- **Impacto:** (1) Coste real: llamadas ilimitadas a Gemini (dinero directo). (2) SSRF: descarga URLs arbitrarias (red interna/metadata).
- **Fix:** apikey allowlist + JWT (como booking-authority); rate-limit; restringir fetch a hosts del bucket del proyecto.
- **Esfuerzo:** M

### [ALTO] RLS permite INSERT/UPDATE directo de `bookings` saltándose el motor autoritativo
- **Archivo:** dawn_castle.sql:189-200 ("Clients can create bookings" INSERT WITH CHECK solo client_id; "Participants can update bookings" UPDATE sin WITH CHECK); INSERT/UPDATE a authenticated nunca revocado
- **Problema:** Un cliente autenticado puede INSERT bookings con total_price arbitrario, y un participante puede UPDATE su reserva sin WITH CHECK cambiando total_price/status (p.ej. completed) por PostgREST, saltándose booking-authority y el webhook.
- **Impacto:** Manipulación de importes/estado fuera del motor (defensa en profundidad rota). Jardinero podría marcar completed sin booking-complete; cliente crear reservas con precio a su antojo.
- **Fix:** Revocar INSERT/UPDATE directos a authenticated y forzar por RPC SECURITY DEFINER; si se mantiene UPDATE, WITH CHECK que congele total_price/status.
- **Esfuerzo:** M

### [MEDIO] `booking-confirmation-email` sin verificación del llamante — send-email-notification/index style
- **Archivo:** booking-confirmation-email/index.ts:55-70. Alcanzable con anon key; acepta bookingId(s) y envía emails reales con datos de esa reserva. Fix: restringir a service_role (secreto compartido con webhook) o JWT + propiedad.
### [MEDIO] Bucket `applications` PÚBLICO con documentos de solicitud (avatar+proof+certs) — 20260606160000_fix_applications_upsert_and_storage.sql:6-24. Lectura pública de todo el bucket. Fix: privado + createSignedUrl, o separar avatar público de documentos privados.
### [MEDIO] Google Maps API key y email admin en el historial de git — DEPLOY_VERCEL.md (commits 3f628d0, f99d70d): AIzaSyBxq8Jh-...Zy14. La service_role NUNCA se commiteó (verificado ✅). Fix: rotar/eliminar la key histórica en Google Cloud, restringir por referrer+API. **Pendiente manual (restricción Maps).**
### [BAJO] `booking-telemetry` acepta inserts sin usuario (apikey sí, user_id opcional, sin rate limit) — booking-telemetry/index.ts:140-149
### [BAJO] service_images/services/availability de lectura pública — INTENCIONAL para marketplace, sin PII, aceptable.

**Verificado LIMPIO (lo mejor construido del proyecto):**
- booking-payment-webhook: firma Stripe HMAC-SHA256 con comparación en tiempo constante, tolerancia 300s, multi-secreto; idempotencia con ledger stripe_webhook_events. Robusto. verify_jwt=false aquí es correcto (Stripe no envía JWT).
- booking-authority: precio NO manipulable por cliente (recalcula con additional_config de la BD, no del payload; firma SHA-256; valida franjas). booking-payment recomputa y aborta si no cuadra.
- booking-complete: JWT + gardener_id===user.id + guarda de estado. booking-manual-declaration: JWT, client_id del token, validación server-side, idempotencia.
- Cliente Supabase: solo URL+clave pública; advierte si detecta service_role en runtime. Sin service_role en cliente.
- Rutas admin: protegidas en cliente Y por RLS server-side (is_admin()/role='admin'). No dependen solo del router.
- XSS: 0 dangerouslySetInnerHTML; emails escapan input.

---

## Dim 1 — Lógica de negocio / paridad de precios (subagente, completo)

**Arquitectura verificada:** booking-authority, booking-payment y el front importan el MISMO src/shared/bookingQuoteCore.ts (sin duplicado). El wizard manual construye las mismas colecciones que el flujo IA (manualEntryBuilders.ts) y ambas pasan por buildAuthoritativeBookingQuote. Paridad estructural buena; los hallazgos son sobre ramas concretas del motor y la tabla fitosanitaria.

### [CRÍTICO] Guard `hasTreeOrPalm` muerto: compara slugs contra UUIDs → palmeras per_hour pierden todos los extras
- **Archivo:** bookingQuoteCore.ts:1382-1390 (+ ServicesPage.tsx:119,205)
- **Problema:** hasTreeOrPalm busca 'poda-arboles'|'poda-palmeras'|'tree'|'palm' en bookingData.serviceIds, pero serviceIds contiene UUIDs (no hay columna slug). El guard es SIEMPRE false. Con jardinero de palmeras en pricing_method:'per_hour', el motor entra en la rama ingenua totalPrice=estimatedHours×precioPorHora en vez de calculatePalmPriceEngine, que aplica fitosanitario (€/ud), pelado de tronco (%) y pricing por unidad vía yield.
- **Impacto:** El jardinero per_hour de palmeras nunca cobra los extras que el cliente activa. Consistente en todos los caminos (mismo motor) → nadie lo detecta comparando pantallas, simplemente se cobra mal siempre.
- **Fix:** Decidir el tipo por el payload (palmGroups?.length || treeGroups?.length), no por strings en serviceIds; o pasar serviceName al motor.
- **Esfuerzo:** S

### [ALTO] Fitosanitarios: el camino manual/legacy cobra tarifas distintas al camino IA para el mismo jardín
- **Archivo:** bookingQuoteCore.ts:720-785 (normalizador), 858-869 y 976-998 (rama sin métricas)
- **Problema:** El wizard manual produce zonas sin analysisMetrics, cobradas con tablas superficies_*. El configurador solo escribe detailed_pricing → las tablas se rellenan por fallback con mapeos incorrectos: (a) preventivo+químico → 'insecticida' → tarifa CURATIVA (IA cobra preventiva); (b) 'Plantas bajas' manual usa superficies_plantas = tarifas de CÉSPED (IA usa detailed.plantas.{tamaño}); (c) palmeras mas_de_3m → siempre medianas_curativo (tarifa altas inalcanzable), árboles grandes inalcanzable.
- **Impacto:** Mismo cliente+jardinero paga distinto según fotos vs manual; caso (a) sobrecobra sistemáticamente.
- **Fix:** En la rama sin métricas derivar tarifa desde detailed_pricing usando intent (preventivo/curativo) y tipo real; añadir tramo altas/grandes.
- **Esfuerzo:** M

### [ALTO] Métricas de herbicida extraídas por la IA pero nunca cobradas ni convertidas en horas
- **Archivo:** ai-pricing-estimator/new_prompts.ts:623-624 vs bookingQuoteCore.ts:881-917 y 1339-1364
- **Problema:** El prompt/UI manejan herbicida_poca/mucha_densidad_m2, pero el motor no tiene término para ellas, hasDetailedMetrics no las cuenta y el bucle de horas las ignora. Zona solo-herbicida cae a rama por área con type='herbicida' → intent no reconoce 'herbicida' → default preventive → se cobra como insecticida (curativa) sobre zone.area.
- **Impacto:** El jardinero hace el herbicida gratis (si acompaña otras métricas) o el cliente paga un concepto no pedido con tarifa equivocada. Esas horas no bloquean slots.
- **Fix:** Eliminar herbicida del prompt/UI (el desbroce ya lo cubre) o añadir término de precio+yield.
- **Esfuerzo:** M

### [ALTO] Horas de palmeras: fallback silencioso a tabla genérica cuando faltan yields (per_quantity)
- **Archivo:** pricingEngine.ts:241-295
- **Problema:** calculatePalmHoursFromConfig usa PALM_CONSTANTS genérica si falta yield_units_per_hour (yields parciales → grupos sin yield aportan 0 horas). El core no tiene barrera missing_yield_config para palmeras (sí para césped/setos/arbustos/desbroce/fito). Viola la regla "el tiempo usa los rendimientos del jardinero concreto".
- **Impacto:** Slots bloqueados con duración que no es la del jardinero → solapes o huecos; en per_hour distorsiona precio.
- **Fix:** Añadir barrera missing_yield_config para palmeras; eliminar fallback genérico.
- **Esfuerzo:** S/M

### [MEDIO] per_hour: los recargos de estado del jardinero no influyen (multiplicadores fijos 1.3/1.7) — bookingQuoteCore.ts:437-444,1390-1391
### [MEDIO] Cirugía de palmera (fito) siempre al precio MÁXIMO de los tres tramos — bookingQuoteCore.ts:909-913
### [MEDIO] Árboles: yields/precios small/medium sin barrera de elegibilidad → cobra el mínimo con config incompleta — treePruningPricing.ts:56-62,86-93,131-136
### [MEDIO] Endoterapia: fuera del default tratamientos_activos (excluye jardineros en rama sin métricas) y ausente del wizard manual — bookingQuoteCore.ts:730,959,1507
### [MEDIO] Techos de plausibilidad asimétricos: manual admite lo que la IA mandaría a revisión (césped 5000 vs 2000, arbustos 2000 vs 500) — manualEntrySchema.ts:322-332
### [MEDIO] wasteRemoval global por defecto TRUE si el flag no llega — bookingQuoteCore.ts:1057 (verificar que el serializador siempre lo fija)
### [BAJO] Fito manual: un toggle ">2-3m" alimenta dos umbrales (2m setos/3m árboles-palmeras) — manualEntrySchema.ts:674-688
### [BAJO] Matching estado seto: 'muy descuidado' con espacio cae a media — bookingQuoteCore.ts:1420-1421
### [BAJO] Horas locales de DetailsPage con heurísticas propias (solo display, no bloqueo real) — DetailsPage.tsx:2191-2195,2350,2408

**Verificado LIMPIO:**
- Comisión 12,5%: se aplica EXACTAMENTE UNA VEZ en buildQuoteEconomics (bookingQuoteCore.ts:389,570) tras el mínimo. Stripe cobra solo payableNow=managementFee; booking-payment reejecuta el motor y aborta si no cuadra. El panel del jardinero muestra total_price sin fee. ✔
- booking-authority = motor del cliente (mismo bookingQuoteCore); valida rangos manuales server-side (422, nunca trunca). ✔
- estimatedHours/slots: solo el servidor calcula la duración para bloquear. ✔
- Ceros explícitos respetados (fix de auditoría previa aplicado en los 6 sitios). ✔
- Setos, desbroce, árboles y palmeras (paridad de variables): enums IA↔manual↔motor alineados salvo los hallazgos anteriores. ✔

**No revisado a fondo (presupuesto):** analysisV2.ts contrato interno, detailsPageAdapters campo a campo, render de economics en ConfirmationPage, manualCorrectionRecompute.

---

## Hallazgo adicional (descubierto probando en vivo, 2026-07-13)

### [ALTO] Onboarding de jardinero: subir foto desde iPhone (HEIC) falla con mensaje engañoso
- **Dimensión:** 7 Features / conversión
- **Archivo:** src/components/gardener/GardenerApplicationWizard.tsx:223-233 (uploadPhoto) + src/utils/imageCompression.ts:19,42 + bucket `applications` (allowed_mime_types: image/jpeg,image/png,image/webp,application/pdf)
- **Problema:** El bucket solo acepta jpeg/png/webp/pdf. `compressImage` convierte a jpeg SOLO si el navegador puede decodificar la imagen en canvas; con HEIC/HEIF (formato por defecto de las fotos de iPhone) el canvas suele fallar y se sube el archivo original `image/heic`, que el bucket rechaza con 415. El catch muestra "No se pudo subir la foto. Revisa tu conexión e inténtalo de nuevo." — mensaje engañoso: no es la conexión, es el formato. **Esto ocurre también en producción** (misma config de bucket), no es solo local.
- **Impacto:** Un jardinero que se registra desde su iPhone (mayoría del público móvil) no puede subir su foto de perfil/documentos y no entiende por qué. Bloquea el onboarding de jardineros → menos oferta en el marketplace.
- **Fix:** (a) convertir HEIC en cliente (p.ej. heic2any) antes de subir, o añadir image/heic,image/heif a allowed_mime_types y convertir server-side; (b) mensaje de error específico por tipo/tamaño ("Formato no admitido, usa JPG/PNG" / "La imagen supera 5 MB"); (c) validar tipo/tamaño antes de intentar subir.
- **Esfuerzo:** M

> Nota de entorno (SOLO local, no es bug de producción): el Storage local (storage-api v1.58.17) tiene el esquema `storage` desincronizado — falta la columna `level`/migraciones internas recientes — y devuelve `DatabaseInvalidObjectDefinition` incluso con JPEG válido. Se resuelve con `supabase db reset` (reconstruye el esquema, pero borra datos de prueba locales). No afecta a producción.
