# GarSer — Informe de Auditoría de Producción (2026-07-12)

Auditoría integral pre-lanzamiento con usuarios y dinero real. Dos superficies: código estático (todo el repo, 7 dimensiones vía subagentes) + web en vivo (funnel móvil). **No se modificó ningún archivo de código**; este informe es el único entregable. Detalle por dimensión en `01-static-findings.md`, `02-live-findings.md` y `00-app-map.md`.

---

## Veredicto: NO-GO todavía

La app está **bien construida en su núcleo** (el motor de precios y el pago con Stripe están, con diferencia, lo mejor hecho: firma de webhook, idempotencia y recálculo autoritativo de precio son sólidos y no manipulables). Pero **no debe salir a producción con usuarios y dinero reales hasta cerrar los 5 bloqueantes**, porque hoy: se puede volcar el teléfono y la dirección de todos los usuarios con la clave pública, se cobra dinero que no se puede devolver, y los emails de confirmación no se envían.

Ninguno de los 5 bloqueantes es estructural: son fixes acotados (S/M). Con ellos resueltos y los 4 pendientes manuales cerrados, el veredicto pasa a GO.

### Recuento por severidad

| Severidad | Nº | Concepto |
|---|---|---|
| CRÍTICO | 6 | 2× fuga PII (profiles, gardener_profiles), 2× dinero sin reembolso, emails no se disparan, reseñas nunca visibles al elegir |
| ALTO | 10 | Manipulación RLS de bookings, relay de email, coste/SSRF en IA, webhook atascable, doble vía de reserva, palmeras per_hour mal cobradas, fito manual≠IA, herbicida no cobrado, cliente sin cancelar, debug en admin, logs con PII |
| MEDIO | ~20 | Reembolsos parciales, huérfanos en storage, plausibilidad asimétrica, bucket público, Maps key en git, catch-all 404, code-splitting, etc. |
| BAJO | ~18 | Copy sin tildes, código muerto, etiquetas, pulido |

### Top 5 bloqueantes de producción

1. **PII de todos los usuarios legible con la clave pública** — las tablas `profiles` y `gardener_profiles` tienen una policy `USING(true)` + `GRANT ... TO anon` de sept-2025 que nunca se revocó. Cualquiera con la anon key (va en el bundle) puede volcar nombre, teléfono y dirección de todos. RGPD. Fix: 1 migración (S).
2. **Dinero cobrado que no se puede devolver** — no existe *ninguna* llamada a reembolso en todo el repo (verificado). El cliente paga la comisión del 12,5% antes de que el jardinero acepte; si rechaza o caduca a 24h, o si el pago se captura pero el INSERT de la reserva falla, el dinero se queda cobrado sin reserva y sin refund automático. Fix: ruta de refund + captura diferida (M).
3. **Los emails de confirmación de reserva no se envían en producción** — el código es correcto pero la función `booking-payment-webhook` desplegada (v10, 25-may) es anterior a la integración de emails. Ni cliente ni jardinero reciben nada al pagar. Fix: redesplegar funciones con `--use-api` (S).
4. **Las reseñas nunca se ven al elegir jardinero** — se escriben en `rating`/`total_reviews` pero la pantalla de elección lee `rating_average`/`rating_count` (columnas distintas que nadie actualiza). Todo jardinero sale "Nuevo" para siempre; la prueba social —clave de conversión— está rota. Fix: alinear columnas / trigger (S-M).
5. **Precios mal cobrados en varias ramas** — el guard `hasTreeOrPalm` compara slugs contra UUIDs y siempre es `false`, así que las palmeras por hora pierden todos los recargos (fitosanitario, pelado); además el fitosanitario manual cobra distinto que por fotos, y el herbicida se extrae pero no se cobra. Fix: decidir tipo por payload + revisar tabla fito (S-M).

---

## Hallazgos CRÍTICOS

### 1. Tabla `profiles` con PII legible por anónimos
- **Dim:** 3 Seguridad · **Archivo:** supabase/migrations/20250929000001_anonymous_booking_access.sql:89-96,117
- **Problema:** Policy SELECT `USING(true)` + `GRANT SELECT TO anon`, nunca revocados. `profiles` = full_name, phone, address, avatar_url.
- **Impacto:** Volcado anónimo de PII de todos los usuarios vía PostgREST con la clave pública. RGPD.
- **Fix:** Migración: DROP de ambas policies SELECT abiertas + REVOKE SELECT FROM anon. Exponer datos públicos del jardinero por vista con columnas mínimas. · **Esfuerzo:** S

### 2. `gardener_profiles` legible por anónimos (teléfono, dirección, coordenadas)
- **Dim:** 3 Seguridad · **Archivo:** 20250929000001_anonymous_booking_access.sql:23-30,114
- **Problema:** Mismo patrón; incluye phone/address/operational_latitude/longitude NOT NULL.
- **Impacto:** Volcado anónimo de contacto y ubicación exacta de todos los jardineros.
- **Fix:** Revocar SELECT anónimo; vista pública sin phone/address/coords exactas. · **Esfuerzo:** S

### 3. No existe ninguna ruta de reembolso; se cobra antes de que el jardinero acepte
- **Dim:** 5 Datos/Pagos · **Archivo:** 20260526164950_booking_payment_availability_dedup_fix.sql:636; 20260514090000_booking_request_lifecycle_rpc.sql:118-148,250-262 (`grep refund` = 0)
- **Problema:** La reserva nace `pending` tras cobrar la comisión. Si el jardinero rechaza o caduca a 24h → cancelled/expired con el cargo capturado y sin refund.
- **Impacto:** El cliente paga por un servicio que nunca se presta y no recupera el dinero. Contracargos.
- **Fix:** Emitir refund del PaymentIntent al cancelar/expirar por causa no imputable al cliente; o `capture_method: manual` y capturar solo al aceptar. · **Esfuerzo:** M

### 4. Pago capturado sin reserva → `reconciliation_required` sin reembolso ni alerta
- **Dim:** 5 Datos/Pagos · **Archivo:** 20260526164950_...sql:612-733
- **Problema:** Si Stripe cobra pero el INSERT de bookings falla (o la disponibilidad ya no cuadra), el intento queda en reconciliation_required con el dinero cobrado, resolución 100% manual sin nadie mirando.
- **Impacto:** Dinero retenido indefinidamente sin reserva.
- **Fix:** En cada rama a reconciliation_required con pago capturado, emitir refund automático o marcar+notificar. · **Esfuerzo:** M

### 5. Los emails de reserva no se disparan en producción (webhook desplegado obsoleto)
- **Dim:** 6 Emails · **Archivo:** supabase/functions/booking-payment-webhook/index.ts:620 (código local correcto)
- **Problema:** Webhook desplegado v10 (25-may) anterior a la integración de emails (21-jun). Ni cliente ni jardinero reciben email al pagar. También corren sin fixes posteriores.
- **Fix:** Redesplegar booking-payment-webhook + booking-confirmation-email + send-email-notification (y revisar el resto) con `supabase functions deploy <n> --use-api`; verificar invocaciones en logs. · **Esfuerzo:** S

### 6. Las reseñas nunca llegan a la pantalla de elección de jardinero
- **Dim:** 7 Features · **Archivo:** BookingsList.tsx:177-180 (escribe rating/total_reviews) vs ProvidersPage.tsx:398,805-806 (lee rating_average/rating_count, DEFAULT 0, nadie actualiza)
- **Problema:** Todo jardinero sale "Nuevo" permanentemente pese a tener reseñas. Prueba social rota en el punto de conversión.
- **Fix:** Unificar a un par de columnas (idealmente trigger SQL sobre `reviews` + backfill). · **Esfuerzo:** S-M

> **Nota:** el guard muerto `hasTreeOrPalm` (palmeras per_hour mal cobradas, bookingQuoteCore.ts:1382-1390) está clasificado CRÍTICO en su dimensión (Dim 1) por cobrar mal dinero de forma sistemática; lo incluyo como parte del bloqueante #5 del top. Ver 01-static-findings.md.

---

## Hallazgos ALTOS (resumen — detalle en 01-static-findings.md)

- **RLS permite INSERT/UPDATE directo de `bookings`** saltándose el motor: un cliente puede crear reservas con total_price arbitrario; un participante puede marcar `completed` por PostgREST. (Dim 3 · dawn_castle.sql:189-200)
- **`send-email-notification` sin auth del llamante** → relay de correo de marca GarSer (phishing/spam) con la anon key. (Dim 3)
- **`ai-pricing-estimator` sin auth ni rate limit** → coste ilimitado de Gemini + SSRF por `photo_urls`. (Dim 3)
- **Webhook atascable en `processing`** bloquea el reprocesamiento de Stripe para siempre → pago sin reserva irrecuperable. (Dim 5 · booking-payment-webhook/index.ts:448-454)
- **Doble vía de creación de reservas**: la vía broadcast crea bookings sin pago → `confirmed` alcanzable sin PaymentIntent. (Dim 5)
- **Palmeras `per_hour` cobran mal** (guard muerto, ver arriba); **fitosanitario manual ≠ IA** (sobrecobro sistemático en preventivo→curativo); **herbicida extraído pero no cobrado**. (Dim 1)
- **El cliente no puede cancelar ni reprogramar** ninguna reserva (solo el jardinero). (Dim 7 · BookingsList.tsx:359-378)
- **`ServiceDetail` muestra rating falso "4.8 (127 reseñas)"** hardcodeado (ruta accesible por URL). (Dim 7)
- **Emails aceptar/rechazar disparados desde el navegador del jardinero**, fire-and-forget, errores tragados. (Dim 6)
- **Cancelar reserva confirmada no envía email** (`booking_cancelled` implementado pero nunca invocado). (Dim 6)
- **Herramienta debug `DatabaseFix` montada en el admin de producción** (hace INSERTs reales desde el navegador). (Dim 2)
- **70 console.log con PII en el bundle** (email en reset, userId+email+rol, texto que teclea el cliente). (Dim 2)
- **Botones "volver a elegir horario" inertes en `/reserva/confirmacion`** (aterrizaje del retorno de Stripe). (Dim 4)

## Hallazgos MEDIOS (agrupados)

Pagos/datos: sin política de cancelación con reembolso para el cliente; fotos huérfanas en Storage si se abandona el funnel o falla la limpieza al completar; `booking-complete` marca completed aunque la limpieza falle. Seguridad: `booking-confirmation-email` sin auth del llamante; bucket `applications` público con documentos de solicitud; Maps API key en el historial de git. Precios: recargos de estado ignorados en per_hour; cirugía de palmera siempre al precio máximo; árboles small/medium sin barrera de config; endoterapia excluida del default y del manual; techos de plausibilidad manual > IA; wasteRemoval default TRUE. Flujos: sin catch-all 404 (URL desconocida = pantalla en blanco); retorno de pago pierde sync si falta quoteId; estado `in_progress` huérfano. Infra: bundle único 1,43 MB sin code-splitting; email-otp fantasma en producción; MOCK de email devuelve success sin secrets. UX: fallback de imágenes de servicio con aspecto de error.

## Hallazgos BAJOS (agrupados)

~25 archivos sueltos en la raíz (check_*, fix_*, debug-*, apply_*) + `dogfood-output/` trackeados; script npm `seed:services` roto; código muerto (TreePruning*, ServiceCatalog, ServiceDetail, useServiceData, roleLogger, BookingCheckoutPage, 2ª Route "/"); rutas debug en el bundle; docs ARCHITECTURE.md/PATTERNS.md describen una arquitectura ya inexistente; 9 directorios vacíos; 3 errores de lint + 816 warnings; copy público sin tildes; admin "Ingresos Totales" = GMV bruto no comisión; perfil jardinero "5.0 (0 reseñas)"; jardinero ve en su email el total del cliente con comisión; toggle fito manual 2m/3m ambiguo; TODO de mapeo de fotos por zona.

---

## Checklist de production-readiness

**Antes de salir (bloqueantes):**
- [ ] Revocar lectura anónima de `profiles` y `gardener_profiles` (migración) + verificar el resto de tablas con PII
- [ ] Implementar reembolso automático (cancelación/expiración/reconciliación con dinero capturado) o captura diferida
- [ ] Endurecer el webhook: no tratar `processing` como terminal (reprocesable)
- [ ] Redesplegar todas las edge functions con `--use-api` y verificar en logs que los emails de confirmación se envían
- [ ] Alinear columnas de rating para que las reseñas se vean al elegir jardinero
- [ ] Corregir el guard `hasTreeOrPalm` (palmeras per_hour) + fito manual vs IA + herbicida
- [ ] Revocar INSERT/UPDATE directos de `bookings`; forzar por RPC
- [ ] Cerrar `send-email-notification` y `ai-pricing-estimator` (auth + rate limit + allowlist de fetch)
- [ ] Quitar `DatabaseFix` del admin y purgar los console.log con PII (drop console en build)

**Semana 1 (post-lanzamiento, con vigilancia):**
- [ ] Cancelar/reprogramar reserva para el cliente
- [ ] Emails de cancelación / solicitud expirada; mover el dispatch aceptar/rechazar a server-side
- [ ] Catch-all 404; arreglar botones inertes de `/reserva/confirmacion`
- [ ] Bucket `applications` privado con URLs firmadas
- [ ] Barrido de fotos huérfanas en Storage
- [ ] Barreras de config faltantes (palmeras yields, árboles small/medium, endoterapia); recargos per_hour reales; plausibilidad alineada
- [ ] Code-splitting; limpieza de código muerto y archivos sueltos; corregir copy sin tildes

**Pasos manuales del propietario (fuera del código):**
- [ ] Personalizar plantillas de email de Auth en el dashboard de Supabase (confirmación, reset, magic link)
- [ ] Subir las 7 imágenes reales de servicios al bucket `marketing-assets` (paths en marketingImageSlots)
- [ ] Restringir la Google Maps API key por referrer+API y rotar la key histórica del git
- [ ] Verificar `supabase secrets list` (SMTP_USER = remitente @garser.es verificado en Brevo, SMTP_PASS) y hacer un envío de prueba real (el modo MOCK devuelve success sin enviar)
- [ ] Prueba E2E con dinero real en Stripe (un ciclo completo cobro→reserva→email→cancelación→reembolso); ningún análisis de código la sustituye
- [ ] Revisar la función `email-otp` desplegada sin código en el repo y borrarla si está muerta

## Verificación de toolchain (2026-07-12)
- `npm run build` ✅ · `npx vitest run` ✅ 356/356 · `npm run lint` 3 errores triviales + 816 warnings · `.env` fuera de git ✅

## Nota sobre el acoplamiento de despliegue
`booking-authority` y `booking-payment` importan `src/shared/bookingQuoteCore.ts`: cualquier cambio en el motor de precios exige redesplegar ambas funciones además del front. Tenerlo presente al aplicar los fixes de Dim 1.
