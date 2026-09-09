# Auditoría de preparación para producción — TRONCO COMÚN

**Rama:** `auditoria/transversal` (salida de `0621680` = `origin/main`)
**Fecha:** 2026-09-09 · auditoría + ronda de correcciones (aprobada por el usuario)
**Alcance:** ciclo de vida de la reserva y el dinero, compartido por los 7 servicios.
**Entorno:** stack de `~/Downloads/GarSer-referencia`, Stripe local en modo test,
cuentas sembradas `cliente.local@test.local` / `jardinero.local@test.local`.

> **Estado tras las correcciones:** F0, F1, F3, F4, F5 y F7 corregidos y verificados
> (§8). F6 no necesitaba código (decisión del usuario: la penalización 1★ ya se dispara
> sólo cuando el profesional cancela una reserva **ya aceptada**; rechazar una solicitud
> pendiente no penaliza — que es lo que hace el código). El stack de referencia se ha
> devuelto a `origin/main` exacto y sin datos de prueba (§9).

---

## 1. VEREDICTO INICIAL: **NO-GO** (resuelto en §8)

Dos bloqueantes en el núcleo del dinero. Los demás hallazgos son corregibles sin bloquear,
pero conviene resolverlos en esta misma ronda transversal antes de abrir las 7 auditorías de
servicio, porque todos viven en ficheros compartidos.

### Bloqueantes

| # | Qué falla | Dónde | Evidencia |
|---|---|---|---|
| **B1** | La **política de cancelación de las 24 h no existe**. El cliente **siempre pierde** la tarifa de reserva, cancele con 1 hora o con 10 días de antelación. La política dice: >24 h → reembolso íntegro; <24 h → la pierde. | `supabase/migrations/20260806121000_booking_lifecycle_rpcs.sql:86-90` · `src/components/client/BookingsList.tsx:137` | §3, F1 |
| **B2** | Con captura diferida (`capture_method: 'manual'`, deliberado), **la reserva sólo se crea por el webhook de Stripe `payment_intent.amount_capturable_updated`**. La sincronización cliente-servidor (`syncAttemptWithStripePaymentIntent`) **no tiene rama para `requires_capture`**: sólo avanza con `succeeded`. Si el webhook falta, llega tarde o falla la firma, el cliente **paga (importe autorizado en su tarjeta) y no se crea ninguna reserva**, sin aviso, sin reconciliación y sin ningún camino de recuperación. | `supabase/functions/booking-payment/index.ts:987-1056` · `supabase/functions/booking-payment-webhook/index.ts:616` · `supabase/functions/booking-payment/index.ts:1077-1081` | §3, F0 |

---

## 2. Cómo leer este informe

- **F0–F1** son los bloqueantes.
- **F3–F6** son hallazgos de severidad media: no bloquean la salida, pero son del tronco común
  y se arreglan mejor ahora.
- **§4 (VERIFICADO OK)** documenta lo que se comprobó y **funciona**, para que el turno 2 y las
  7 auditorías de servicio no lo repitan.
- **§5 (NO PROBADO)** lo que no se pudo cerrar y qué haría falta.
- **§6 (fuera de alcance)** lo que se vio de reojo; parte va a `COORDINACION-SERVICIOS.md` §3.2.

Todas las evidencias son literales, obtenidas contra el código actual (`main`).

---

## 3. HALLAZGOS

### F0 — BLOQUEANTE · El pago se cobra pero no crea reserva sin el webhook de Stripe

**Severidad:** crítica (dinero retenido al cliente, sin reserva, sin recuperación)
**Ámbito:** transversal (todos los servicios, todo el checkout)
**Ficheros:**
- `supabase/functions/booking-payment/index.ts:1077-1081` — el PaymentIntent de la comisión se
  crea con `capture_method: 'manual'` → tras `stripe.confirmPayment` queda en `requires_capture`,
  **no** en `succeeded`.
- `supabase/functions/booking-payment/index.ts:987-1056` — `syncAttemptWithStripePaymentIntent`
  gestiona `succeeded` (crea la reserva), `processing`, `canceled`; **cualquier otro estado,
  incluido `requires_capture`, cae en `markAttemptPending`** y el intento se queda
  `payment_pending` para siempre.
- `supabase/functions/booking-payment-webhook/index.ts:611-629` — la reserva la crea
  `confirm_booking_payment_attempt`, y en el flujo normal la **única** vía que lo invoca en
  ese momento es el webhook `payment_intent.amount_capturable_updated`.
- `src/pages/reserva/ConfirmationPage.tsx:2098-2119` y `:778-797` — tras confirmar el pago, el
  front llama a `resolveAttemptStatus` → `sync_payment_state` (una vez) + polling de
  `get_attempt_status`. Ninguno avanza desde `requires_capture`. Si al agotar el polling el
  estado sigue `payment_pending`, **no hay rama**: el modal se queda abierto sin error.

**Qué falla:** con la captura diferida (que es correcta y deliberada, PR #9), el
PaymentIntent nunca llega a `succeeded` en el momento del pago. La reserva depende al 100 %
de que el webhook de Stripe esté registrado, con el evento correcto seleccionado y el secreto
(`STRIPE_WEBHOOK_SECRET(S)`) configurado. No hay:
- rama cliente para `requires_capture`,
- reconciliación server-side de intentos `payment_pending` con PI ya autorizado
  (`cleanup_expired_booking_payment_state` sólo caduca *holds* y sólo toca intentos en
  `created`/`checkout_open`/`processing`, no `payment_pending`),
- ninguna alerta.

Resultado si el webhook no está perfecto: el cliente ve el formulario, paga, Stripe autoriza
el importe en su tarjeta, y **no se crea reserva**. El jardinero no se entera. El cliente no
tiene forma de ver ni recuperar nada. La autorización se libera sola a los 7 días (Stripe).

**Evidencia literal (E2E en el stack que sirve `main`):**

Pago real desde la UI (`cliente.local`, tarjeta `4242 4242 4242 4242`, `12/30`, `123`):

```
# PaymentIntent en Stripe tras pulsar "Pagar 7,88 €":
GET /v1/payment_intents/pi_3UDjHu2MwFyGXuB71yDXpnC4
{ "status": "requires_capture", "amount": 788, "amount_received": 0,
  "amount_capturable": 788, "capture_method": "manual" }

# booking_payment_attempts (BD) tras la sincronización del front:
status = payment_pending
gateway_response = { "syncedFrom": "booking-payment:sync_payment_state",
                     "paymentIntentStatus": "requires_capture" }

# booking_funnel_events:
booking.payment_state_synced -> payment_pending   (repetido)

# public.bookings:  0 filas.   (ninguna reserva creada)
```

El stack de referencia **no tiene** `STRIPE_WEBHOOK_SECRET` en `supabase/functions/.env`,
ni `stripe listen`, ni Stripe CLI. La premisa del encargo («el front sincroniza contra
Stripe, sin webhook») **no se cumple para la captura diferida**.

Para poder auditar el resto del ciclo, se simuló el webhook a mano invocando
`confirm_booking_payment_attempt(... 'payment_intent.amount_capturable_updated' ...)` con la
clave de servicio.

**Fix propuesto (a decidir):**
1. **Mínimo:** añadir en `syncAttemptWithStripePaymentIntent` una rama para
   `requires_capture` (y `requires_confirmation` cuando ya hay cargo) que invoque
   `confirm_booking_payment_attempt` igual que hace el webhook. Así el front crea la reserva
   sin depender del webhook, que pasa a ser redundante en vez de único.
2. **Recomendado además:** un cron de reconciliación (o extender `booking-lifecycle-tick`)
   que barra `booking_payment_attempts` en `payment_pending` con PI `requires_capture` /
   `succeeded` y los consolide o los mande a `reconciliation_required` con alerta.
3. **Operativo:** documentar el webhook como requisito de despliegue y añadir una comprobación
   de salud (último evento recibido) al panel de admin.

---

### F1 — BLOQUEANTE · La política de reembolso de cancelación no está implementada

**Severidad:** crítica (incumple una política de dinero explícita del negocio)
**Ámbito:** transversal
**Ficheros:**
- `supabase/migrations/20260806121000_booking_lifecycle_rpcs.sql:75-90` — `cancel_booking`.
  Para el actor `client`:
  ```sql
  v_money_action := CASE WHEN v_booking.status = 'pending' THEN 'capture' ELSE 'none' END;
  ```
  **No hay ninguna comparación de `now()` con la hora de inicio de la reserva.** Cero lógica
  de antelación. `cancel_booking` se define una sola vez en las migraciones; no hay
  redefinición posterior.
- `src/components/client/BookingsList.tsx:137` — el diálogo de confirmación está fijo:
  ```
  `Se liberará el hueco del profesional. Los ${formatEuro(booking.management_fee)} de gastos
   de gestión que ya abonaste no se devuelven.`
  ```
  No varía según la antelación, y afirma «ya abonaste» incluso cuando el importe sólo está
  retenido (reserva `pending`).
- `src/components/booking/ClientBookingCard.tsx:144` — el botón «Cancelar reserva» se muestra
  para cualquier reserva `pending` o `confirmed` (`isCancellableStatus`), sin lógica temporal.
- Búsqueda en `src/` de lógica de 24 h / antelación / `cancellationPolicy`: **nada**.

**Política que debe cumplirse (y no se cumple):**
> Cliente cancela con **más de 24 h** de antelación → se le devuelve **entera** la tarifa de
> reserva. Con **menos de 24 h** → la pierde.

**Comportamiento real:** el cliente **siempre** pierde la tarifa de gestión (se captura si la
reserva estaba `pending`, o se mantiene capturada si estaba `confirmed`), sin importar la
antelación. El único caso que «acierta» es el de <24 h, y por casualidad, no por regla.

**Evidencia literal (E2E, Stripe test):**

```
# Reserva a71a3866, inicio 2026-09-11 09:00. Cancelada por el cliente 2026-09-09 ~13:16
# => ~44 horas de antelación (>> 24 h).
POST booking-payment {"action":"cancel_booking","bookingId":"a71a3866-..."}
-> {"status":"cancelled","moneyAction":"capture","moneyStatus":"captured","penaltyApplied":false}

GET /v1/payment_intents/pi_3UDjHu2MwFyGXuB71yDXpnC4
-> {"status":"succeeded","amount_received":788,"amount_capturable":0}     # 7,88 € COBRADOS
GET /v1/refunds?payment_intent=pi_3UDjHu2MwFyGXuB71yDXpnC4
-> data: []                                                              # 0 reembolsos
```

```
# Reserva d17aa228 CONFIRMED (comisión ya capturada), inicio 2026-09-14 10:00.
# Cancelada por el cliente 2026-09-09 => ~5 días de antelación.
POST booking-payment {"action":"cancel_booking","bookingId":"d17aa228-..."}
-> {"status":"cancelled","moneyAction":"none","moneyStatus":"none","penaltyApplied":false}
GET /v1/payment_intents/pi_3UDjNz2MwFyGXuB71WgPISc5
-> {"status":"succeeded","amount_received":788}                          # 7,88 € retenidos por GarSer
GET /v1/refunds?...  -> data: []
```

**Fix propuesto:**
1. En `cancel_booking`, para `v_actor = 'client'`, calcular la antelación con
   `public.booking_service_start(v_booking)` (ya existe) y decidir:
   - `now() <= start - interval '24 hours'` → `v_money_action := CASE WHEN status='pending'
     THEN 'release' ELSE 'refund' END` (devolver íntegro);
   - en otro caso → `CASE WHEN status='pending' THEN 'capture' ELSE 'none' END` (pierde la
     tarifa, comportamiento actual).
2. En `booking-payment/index.ts` el `moneyAction` `refund`/`release` ya está soportado
   (líneas 1430-1482), no hace falta tocar la función.
3. En el front, sustituir el texto fijo de `BookingsList.tsx:137` por un mensaje que calcule
   la antelación y diga el importe exacto que se recupera **antes** de confirmar
   («Faltan más de 24 h: se te devolverán 7,88 €» / «Faltan menos de 24 h: perderás 7,88 €»).
   Idealmente mover el cálculo a un helper compartido (`bookingAmounts.ts` o
   `bookingLifecycleService.ts`) para que servidor y cliente no puedan divergir.

---

### F3 — MEDIA · La captura de la comisión al aceptar depende del navegador del jardinero

**Severidad:** media (pérdida de ingresos silenciosa, misma forma que F0)
**Ámbito:** transversal
**Ficheros:** `src/utils/bookingRequestService.ts:113-136` ; `src/utils/bookingPriceChangeService.ts` (rama accept).

`respondBookingRequest` cambia el estado con la RPC y **después**, best-effort, invoca
`finalize_booking_payment` (que captura en Stripe). Si esa segunda llamada falla (red, cierre
de pestaña, 500), la reserva queda `confirmed` pero el PaymentIntent sigue en
`requires_capture`: **GarSer nunca cobra la comisión de esa reserva** y la autorización se
libera sola a los 7 días. El comentario lo asume («se captura al reintentar o caduca sola»),
pero no hay reintento server-side ni reconciliación. Mismo patrón en el accept de un cambio
de precio.

**Fix propuesto:** el cron/reconciliación de F0 cubre también este caso (barrer reservas
`confirmed` cuyo PI siga `requires_capture` y capturar). Alternativa: mover la captura a un
trigger `AFTER UPDATE` de `bookings` sobre la transición a `confirmed` que encole el trabajo.

---

### F5 — MEDIA · Aceptar un cambio de precio bloquea una hora de más en la agenda, y no se libera

**Severidad:** media (el jardinero pierde un hueco de calendario por cada reserva con cambio
de precio, de forma permanente)
**Ámbito:** transversal (el cambio de precio es común a los 7 servicios)
**Fichero:** `supabase/migrations/20260803121000_fix_price_change_security_definer.sql:231-240`

```sql
v_start_hour := cast(split_part(v_booking.start_time::text, ':', 1) as int);
v_duration := COALESCE(v_booking.duration_hours, 1);
FOR v_hour IN v_start_hour .. (v_start_hour + v_duration) LOOP   -- bucle INCLUSIVO
  UPDATE public.availability SET is_available = false
  WHERE gardener_id = v_booking.gardener_id AND date = v_booking.date
    AND start_time = (lpad(v_hour::text, 2, '0') || ':00:00')::time;
END LOOP;
```

El rango canónico de bloqueo (creación de reserva y `reserve_booking_schedule`,
`20260514090000_booking_request_lifecycle_rpc.sql`) es `[start, start + duration)` — exclusivo.
Aquí es **inclusivo**: para un servicio de 3 h desde las 09:00 marca no disponible 09, 10, 11
**y 12**. Como no hay fila en `booking_blocks` para la hora 12, `release_booking_schedule` no
la restaura nunca al cancelar: el hueco queda muerto.

**Evidencia literal (E2E):**

```
# Reserva 89ed8937, inicio 2026-09-18 09:00, duration 3 h. Cambio de precio 63->90, cliente acepta.
availability 2026-09-18 ANTES:  08:t 09:f 10:f 11:f 12:t 13:t ...
availability 2026-09-18 DESPUÉS: 08:t 09:f 10:f 11:f 12:f 13:t ...   <-- 12:00 bloqueada de más
SELECT count(*) FROM booking_blocks WHERE booking_id = '89ed8937-...';  -> 3   (09,10,11)
```

**Fix propuesto:** `FOR v_hour IN v_start_hour .. (v_start_hour + v_duration - 1) LOOP`.
Mejor aún: que el accept del cambio de precio llame a `reserve_booking_schedule` (que ya
valida solapamientos y escribe `booking_blocks`) en vez de repetir a mano el bloqueo de
`availability`. Ojo: `respond_booking_price_change` accept **no** llama a
`reserve_booking_schedule`; en el flujo normal la reserva ya tiene `booking_blocks` desde su
creación, así que el `UPDATE` de `availability` de la RPC es redundante salvo por la hora que
sobra.

---

### F6 — DECISIÓN DEL USUARIO · El "rechazo" del profesional no dispara la penalización de 1★

**Severidad:** requiere decisión (la parte de dinero es correcta)
**Ámbito:** transversal
**Ficheros:**
- `supabase/migrations/20260514090000_booking_request_lifecycle_rpc.sql:252-264` —
  `respond_booking_request` rama `reject`: cambia el estado a `cancelled` y libera la agenda.
  **No inserta ninguna reseña.**
- `supabase/migrations/20260806121000_booking_lifecycle_rpcs.sql:76-85` — `cancel_booking`
  con `v_actor = 'gardener'` sólo pone `v_penalty := true` **si la reserva estaba
  `confirmed`** (es decir, si el jardinero ya había aceptado). Un rechazo de solicitud
  pendiente no penaliza.

La política escrita dice: «Cancela **o rechaza** el profesional… GarSer deja automáticamente
al profesional una valoración de **1 estrella**». El código sólo penaliza el
*cancela-después-de-aceptar*, no el *rechaza-antes-de-aceptar*.

**Por qué es una decisión y no un bug directo:** con solicitudes en abanico
(`create_broadcast_booking_requests`), cada jardinero recibe una solicitud y la mayoría la
rechaza o la deja caducar. Penalizar con 1★ cada rechazo destruiría el marketplace. Hace
falta que definas qué cuenta como «rechazo penalizable» (¿solo reservas dirigidas a un único
jardinero? ¿nunca?).

**Evidencia literal (E2E):**

```
# Reserva 338a0444 pendiente. El jardinero la RECHAZA (respond_booking_request 'reject').
-> booking status = cancelled ; finalize_booking_payment 'reject' -> PI canceled, amount_received 0
public.reviews : sigue habiendo SÓLO la penalización de B3 (cancela-tras-aceptar). Ninguna nueva.
```

La parte de dinero **sí** es correcta: la autorización se libera y el cliente no paga nada.

---

### F4 — MENOR · `proposeBookingPriceChange` envía un email de "rechazo" al proponer

**Severidad:** menor (emails están fuera de alcance, pero es código compartido roto y error de tipos real)
**Fichero:** `src/utils/bookingPriceChangeService.ts:69-73`

```js
void notifyPriceChange(
  params.bookingId,
  params.accept ? 'booking_price_change_accepted' : 'booking_price_change_rejected',
);
```

`proposeBookingPriceChange` no tiene `accept` en sus parámetros (es copia de
`respondBookingPriceChange`). `params.accept` es `undefined` → siempre se envía
`booking_price_change_rejected` en el momento de **proponer** un cambio de precio, además del
`booking_price_change_proposed` correcto.

`npx tsc --noEmit -p tsconfig.app.json` lo confirma:
```
src/utils/bookingPriceChangeService.ts(70,12): error TS2339: Property 'accept' does not
exist on type '{ bookingId: string; proposedTotalPrice: number; reason?: string | undefined;
expiresInMinutes?: number | undefined; operationId?: string | undefined; }'.
```

**Fix propuesto:** borrar el segundo `notifyPriceChange` de `proposeBookingPriceChange`
(sólo debe enviarse `booking_price_change_proposed`).

---

### F7 — MENOR (proceso) · El "gate" de tipos que usa la coordinación no comprueba nada

**Fichero:** `tsconfig.json` — `{ "files": [], "references": [...] }`.

`docs/audit/COORDINACION-SERVICIOS.md` §4 exige `npx tsc --noEmit -p tsconfig.json` limpio
para cerrar un servicio. Con `files: []` y sin `--build`, ese comando **no type-checkea
ningún fichero** (da 0 errores porque no mira nada). El chequeo real es
`tsconfig.app.json` (= `npm run typecheck`), que en `main` tiene **173 errores**
(mayoría `TS6133` variables sin usar, pero incluye F4 y varios `TS2345`/`TS2322` reales).

**Fix propuesto:** cambiar el gate a `npx tsc --noEmit -p tsconfig.app.json` (o
`tsc --build`), y limpiar los 173 errores o al menos congelar la cifra y prohibir nuevos.

---

## 4. VERIFICADO OK — no hace falta volver a auditarlo

Todo esto se comprobó de punta a punta (código + E2E con Stripe/BD) y **cumple**:

| Área | Resultado | Evidencia |
|---|---|---|
| **Importes / comisión** | `managementFee = round(serviceGrossTotal × 0,125)`, `payableNow = managementFee`. La UI de checkout, la de confirmación y la tarjeta muestran los mismos 3 importes (servicio / gestión / total). Reserva de 63,00 € → gestión 7,88 € → total 70,88 €. | `bookingQuoteCore.ts:542-555`, `bookingAmounts.ts`; captura del funnel |
| **`management_fee` inmutable** | Columna persistida; `respond_booking_price_change` accept cambia `total_price` pero **no** `management_fee` (trigger `trg_bookings_management_fee_guard`). Cambio 63→90 → `management_fee` sigue 7,88. | migr. `20260803120000`, `20260803121000:210-219`; E2E B7 |
| **Captura diferida (deliberada)** | PI `capture_method: 'manual'`. Al aceptar el jardinero → `finalize_booking_payment` captura (PI `succeeded`). Al rechazar → `cancel` (PI `canceled`, `amount_received: 0`). | E2E B3/B5/B9 |
| **Jardinero cancela tras aceptar** | `money_action = 'refund'` → `POST /v1/refunds` sin `amount` (íntegro): refund `788` `succeeded`. Se inserta reseña `rating=1`, `is_system_penalty=true`, `system_reason='gardener_cancelled_after_accepting'`, `client_id NULL`. `gardener_profiles.rating_average` pasa a `1.00` (count 1) → **la penalización cuenta para la media**. | `booking_lifecycle_rpcs.sql:76-115`, `booking-payment/index.ts:1430-1441`; E2E B3 |
| **Penalización distinguible** | `public_gardener_reviews` expone `is_system_penalty`, `system_reason` y `author_display_name = 'GarSer'` (nunca un nombre de cliente). `ReviewList.tsx` pinta la insignia «Servicio no completado». | migr. `20260823140000`; `ReviewList.tsx:110-125`; E2E |
| **Jardinero rechaza pendiente (dinero)** | `finalize_booking_payment 'reject'` → PI `canceled`, cliente paga 0 €. | E2E B5 |
| **Cliente cancela <24 h (dinero)** | Pierde la tarifa (`capture`). Coincide con la política — aunque por el bug de F1, no por una regla. | E2E B4 (antelación real 21 h 48 m) |
| **Cambio de precio: aceptar** | `total_price` pasa al propuesto, reserva `confirmed`, comisión capturada, comisión sin recalcular. | E2E B7 |
| **Cambio de precio: rechazar** | Reserva `cancelled`, `finalize` → `released`, PI `canceled`, cliente paga 0 €. | E2E B8 |
| **Cambio de precio sobre reserva confirmada** | **No reproducible**: el trigger `prevent_confirm_when_price_change_pending` (`20260505143000:108`) impide poner `price_change_status='pending_client_acceptance'` en una fila ya `confirmed`. La hipótesis «rechazo de cambio de precio sobre confirmada no reembolsa la comisión ya capturada» **no ocurre**. | E2E B7/B9 |
| **Cierre del servicio** | `confirm_booking_service` (cliente, sólo tras `booking_service_end`) → `completed`; no mueve dinero. Cron `auto_complete_due_bookings` cierra a las 24 h. Aviso de valoración vía mensaje de sistema del chat al pasar a `completed`. | migr. `20260827110000:546-593`, `20260823130000` |
| **Reseña + media** | Cliente reseña 5★ sobre reserva `completed` → trigger `sync_gardener_rating_aggregates` → `rating_average = 3.00`, `rating_count = 2` (1★ penalización + 5★). Visible en `public_gardener_reviews` con autor «Laura F.» (enmascarado). | E2E B6; migr. `20260729120000` + `20260823120000` |
| **Anti-fraude de reseñas** | Reseñar reserva no `completed` → **403** (RLS). Segunda reseña misma reserva → **409** (índice único parcial). Autoreseña del jardinero → **403**. `PATCH gardener_profiles(rating_average, rating_count)` por el jardinero → **403** (grants por columna, `20260823160000`). | E2E |
| **Volver a reservar** | `get_rebook_payload` devuelve dirección + servicio + zonas, **sin ningún importe** (el precio se recalcula en vivo). No propietario → **403**. | migr. `20260823150000`; E2E |
| **Listado de profesionales / PII** | El listado lee `public_gardener_directory` (vista): expone `full_name`, `avatar_url`, ratings, `services`, `max_distance`, `description`, `is_available`, `has_phytosanitary_license`. **Sin** teléfono, dirección, coordenadas ni email. Tablas base `profiles` y `gardener_profiles` → **401** para `anon`. Un cliente recién registrado (sin reservas) ve al jardinero. | migr. `20260713000000`; `ProvidersPage.tsx:428`; E2E |
| **Disponibilidad — huecos y duración** | `valid_hours` en un día con 09-12 ocupado y servicio de 2,5 h (necesita 3 horas seguidas) → `[13,14,15]` (excluye 08 y 16/17). El bloqueo canónico `reserve_booking_schedule` usa `[start, start+duration)` correcto. | E2E; migr. `20260514090000:41-...` |
| **Disponibilidad — cobertura** | Dirección a ~400 km con `max_distance = 40` → exclusión `outside_coverage`. Dirección cercana → elegible, con `earliestSlot`. | E2E `booking-authority preview_providers` |

---

## 5. NO PROBADO (marcado como tal, no como PASA)

| Qué | Por qué no se cerró | Qué haría falta |
|---|---|---|
| **Flujo de pago completo por la UI de principio a fin** | El paso pago→reserva no completa sin webhook de Stripe (ver F0). Se probó el pago real (tarjeta, PI `requires_capture` en Stripe) y a partir de ahí se **simuló** el webhook para seguir. | `stripe listen --forward-to localhost:54321/functions/v1/booking-payment-webhook` con `STRIPE_WEBHOOK_SECRET` en `functions/.env`, o el fix de F0. |
| **`report_no_show` / incidencias / `resolve_incident` (reembolso por admin)** | Fuera del núcleo pedido y requiere reloj > fin de servicio + rol admin. Lectura de código: `report_booking_no_show` (jardinero no aparece) → `money_action='refund'` + reseña 1★ `gardener_no_show`; incidencias → admin decide `refund`/`no_action`. | E2E con reserva en el pasado + cuenta admin. |
| **Concurrencia real de reserva del mismo hueco** | No se probó doble reserva simultánea. `reserve_booking_schedule` tiene `FOR UPDATE` + comprobación `v_available_count <> duration_hours`; el accept de cambio de precio **no** pasa por ahí (relacionado con F5). | Dos `respond_booking_request` en paralelo sobre el mismo slot. |
| **Caducidad de la autorización a 7 días** | No verificable en la ventana de la auditoría. | Observación en Stripe test tras 7 días, o test de reloj. |
| **Emails transaccionales** (confirmación, cancelación, cambio de precio) | Fuera de alcance explícito. Se ve que se invocan best-effort y que F4 dispara uno equivocado. | Auditoría de emails (turno 2). |

---

## 6. FUERA DE ALCANCE — visto de reojo

Anotado, **no** auditado en esta ronda. Lo específico de un servicio va a
`COORDINACION-SERVICIOS.md` §3.2.

- **Puerta de licencia fitosanitaria (→ §3.2).** `booking-authority` y `booking-payment` tienen
  **cero** referencias a `has_phytosanitary_license`. `ProvidersPage.tsx` calcula
  `requiresCertifiedLicense` pero **nunca filtra la lista** por ese campo (sólo cambia textos,
  líneas 479 y 735). Un tratamiento con producto químico convencional (fitosanitarios no
  ecológicos, o desbroce con herbicida) es reservable con un jardinero **sin** carnet. Afecta
  a *fitosanitarios* y *desbroce*, pero el sitio correcto del arreglo es el filtro compartido
  de `booking-authority` / `ProvidersPage`.
- **Redondeo de horas `bookingQuoteCore.ts:1349`** (`if (totalHours > 8) totalHours *= 0.9;`
  seguido de `Math.ceil(totalHours*2)/2`). **Comprobado y NO reproducido** en `main`: el
  residuo de coma flotante es real (`13*0.9 = 11.700000000000001`) pero `Math.ceil` no cambia
  de resultado salvo que el producto caiga exactamente en un entero, cosa que no ocurre con
  entradas reales (barrido de `totalHours` 8,001–40,000 a paso 0,001: 0 casos de sobre-redondeo
  frente a una referencia decimal exacta). La línea es frágil y fea, pero hoy **no** produce
  sobrecoste observable. Se pasa al turno 2 con esta evidencia.
- **Chat, emails, notificaciones, panel de admin, landings públicas.** No auditados.

---

## 7. Acciones manuales del usuario (tras esta ronda de correcciones)

1. **Abrir la PR de `auditoria/transversal` y mergear a `main`.** Sin esto las 7 auditorías
   de servicio no deben arrancar (parten de tu trabajo).
2. **Tras el merge, desplegar** (§4 del fichero de coordinación):
   - `supabase db push` — aplica las 3 migraciones nuevas
     (`20260909120000`, `20260909121000`, `20260909122000`). *(La `supabase functions deploy`
     se cuelga en esta máquina por Docker; usar `--use-api`.)*
   - `supabase functions deploy booking-payment --use-api` (F0)
   - `supabase functions deploy booking-lifecycle-tick --use-api` (F3)
   - Vercel (front: F1 diálogo, F3 reintentos, F4).
3. **F0 — requisito operativo:** el webhook de Stripe
   `payment_intent.amount_capturable_updated` **sigue siendo necesario** como vía principal
   (el fix añade una vía cliente redundante, no lo sustituye). Verifica en el dashboard de
   Stripe de producción que el endpoint `…/functions/v1/booking-payment-webhook` está
   registrado, con ese evento seleccionado, y que `STRIPE_WEBHOOK_SECRET(S)` está en los
   secretos del proyecto.
4. **F3 — requisito operativo:** `booking-lifecycle-tick` ahora necesita `STRIPE_SECRET_KEY`
   en los secretos del proyecto (antes no lo usaba). Sin él, el job 4 se salta con
   `skipped: no_stripe_secret` y el resto del reloj sigue igual.
5. **Vigilar** en `booking_funnel_events` los eventos nuevos del reconciliador:
   `booking.payment_reconcile_captured` (recuperó un cobro — informativo, `warn`),
   `booking.payment_reconcile_capture_lost` (`error`: autorización caducada sin capturar,
   comisión perdida — debería ser 0 en régimen normal),
   `booking.payment_reconcile_captured_on_cancelled` (`warn`: cargo sobre reserva cancelada
   sin reembolsar — revisar caso a caso).
6. **F6:** confirmado sin cambios de código. Si en el futuro quieres que el rechazo de una
   reserva **dirigida a un único** profesional sí penalice, hay que distinguir esas de las
   solicitudes en abanico y tocar `respond_booking_request` — anótalo para una ronda futura.
7. **Estado del stack de referencia:** devuelto a `origin/main` exacto (funciones
   `cancel_booking` y `respond_booking_price_change` restauradas, RPC auxiliares eliminadas)
   y **sin datos de prueba** (0 reservas / presupuestos / intentos / reseñas; jardinero
   sembrado de nuevo como «Nuevo», rating 0; toda la agenda reabierta). En Stripe **test**
   quedan PaymentIntents del ciclo de pruebas (capturas y un reembolso): son objetos inertes
   del entorno de test, no se pueden ni deben borrar.

---

## 8. RONDA DE CORRECCIONES — qué se cambió y cómo se verificó

Verde de tooling tras los cambios: `npx tsc --noEmit -p tsconfig.app.json` → **172 errores**
(base 173; F4 quita uno, ninguno nuevo). `npx vitest run` → **433/433** (5 tests nuevos de
F1). `npx vite build` → OK. `deno check booking-lifecycle-tick` → 0 errores.
`deno check booking-payment` → 13 (= base, ninguno nuevo).

### F0 — `syncAttemptWithStripePaymentIntent` entiende `requires_capture`

`supabase/functions/booking-payment/index.ts` — la rama que crea la reserva ahora acepta
`paymentIntentStatus === 'succeeded' || 'requires_capture'` e invoca
`confirm_booking_payment_attempt` igual que el webhook, con el importe autorizado
(`amount_received || amount_capturable || amount`). Idempotente: si el webhook llega después,
la RPC devuelve el intento ya creado sin duplicar.

**Verificado E2E** (stack de referencia): pago real con tarjeta `4242…` → PI `requires_capture`
→ intento `payment_pending`, **0 reservas** (estado de bloqueo del bug). Se ejecuta la llamada
exacta de la nueva rama →

```
confirm_booking_payment_attempt(attempt, 'client_sync:<attempt>:payment_intent:<pi>', <pi>, 788, 'eur', {...})
  -> {"status":"booking_created","bookingId":"4986170e-…"}
replay (evento distinto, tipo amount_capturable_updated)
  -> {"status":"booking_created","bookingId":"4986170e-…"}   (mismo id)
bookings para el intento: 1   (sin duplicado)
```

*Pendiente de deploy:* el E2E completo por la UI a través de la edge function desplegada.
El `if`/fallback en TS está cubierto por tsc + build + `deno check` (sin errores nuevos).

### F1 — política de reembolso por antelación (24 h)

`supabase/migrations/20260909120000_cancel_booking_24h_refund_policy.sql` — sólo cambia la
rama `v_actor = 'client'` de `cancel_booking`: si `booking_service_start - now() >= 24 h`,
`money_action` = `release` (reserva `pending`) / `refund` (`confirmed`); si no, `capture` /
`none` (comportamiento anterior). El resto (causa del jardinero, penalización, liberación de
agenda) sin tocar.

`src/shared/bookingAmounts.ts` — `getCancellationRefundPreview` + `cancellationConfirmMessage`
(SSOT del mismo umbral). `src/components/client/BookingsList.tsx` — el diálogo ya no lleva
texto fijo: calcula la antelación del caso concreto y dice el importe exacto que se recupera
o se pierde **antes** de confirmar.

**Verificado E2E** (4 casos + 2 regresiones, cada uno con su PaymentIntent real):

| Caso | Antelación | Estado | `money_action` | Stripe | ✓ |
|---|---|---|---|---|---|
| C1 | ~19 h (<24 h) | pending   | `capture` | PI `succeeded` 788 | ✅ pierde tarifa |
| C2 | 15 días (>24 h) | pending | **`release`** | PI **`canceled`**, recv 0 | ✅ nada cobrado |
| C3 | 16 días (>24 h) | confirmed | **`refund`** | **refund 788 `succeeded`** | ✅ devolución íntegra |
| C4b | ~22 h (<24 h) | confirmed | `none` | PI `succeeded` 788, sin refund | ✅ pierde tarifa |
| reg. C5 | jardinero cancela tras aceptar | — | `refund` | refund 788 + reseña 1★ `is_system_penalty` | ✅ sin cambios |
| reg. C6 | jardinero rechaza pendiente | — | `release` | PI `canceled`, **0 reseñas** | ✅ sin cambios |

Tests unitarios nuevos: `src/shared/bookingAmounts.test.ts` (>24 h → importe íntegro; <24 h →
se pierde; corte exacto en 24 h; comisión desconocida → no promete importe; sin fecha → no
reembolsable).

### F3 — respaldo de la captura/liberación diferida

- **Cliente:** `src/utils/bookingPaymentFinalize.ts` (nuevo) — `finalizeBookingPaymentWithRetry`
  reintenta `finalize_booking_payment` / `finalize_price_change_payment` 3× con backoff
  (idempotente en el servidor). Lo usan `bookingRequestService.ts` y `bookingPriceChangeService.ts`.
- **Servidor:** `supabase/migrations/20260909122000_payment_reconciliation_helpers.sql` —
  `list_bookings_pending_payment_reconciliation` (candidatos: `confirmed`→capture,
  cancelada/rechazada/caducada→release; ventana 20 min–7 días; excluye la cancelación tardía
  del cliente, que conserva la tarifa por diseño) + `mark_booking_payment_settled` (marca en
  `gateway_response`). `supabase/functions/booking-lifecycle-tick/index.ts` — **job 4**:
  consulta el estado real en Stripe y **captura** una autorización pendiente / **libera** una
  no capturada. **Nunca reembolsa** un cargo ya capturado (eso rompería F1); si lo ve, lo
  marca y avisa (salvo que ya conste un refund → cierre limpio).

**Verificado E2E:** reserva `confirmed` con PI en `requires_capture` (la comisión nunca se
capturó) → aparece en `list_…` con `desired_action = capture` → simulado el job 4:
`GET` PI (`requires_capture`) → `POST …/capture` (`Idempotency-Key: garser_recon_capture_<b>`)
→ PI `succeeded`, `amount_received 788` → `mark_booking_payment_settled('captured')` →
re-consulta: **excluida** (0 filas). `deno check` del tick: limpio.

### F4 — email erróneo al proponer un cambio de precio

`src/utils/bookingPriceChangeService.ts` — eliminado de `proposeBookingPriceChange` el bloque
que referenciaba `params.accept` (inexistente) y mandaba `booking_price_change_rejected` al
**proponer**. El aviso de aceptada/rechazada se movió a `respondBookingPriceChange`, donde
`accept` sí existe. `tsc -p tsconfig.app.json`: el error `TS2339` de esa línea desaparece
(173 → 172).

### F5 — `respond_booking_price_change` y la agenda del profesional

`supabase/migrations/20260909121000_price_change_accept_uses_canonical_schedule.sql` — tres
arreglos en la misma función:
1. **Aceptar:** el bucle de bloqueo pasa de inclusivo (`.. start + duración`) a
   `[inicio, inicio + duración)` — deja de comerse la hora siguiente.
2. **Aceptar:** las reservas hermanas pendientes que se cancelan ahora liberan su agenda
   (`release_booking_schedule`), como en `respond_booking_request` accept.
3. **Rechazar:** ahora libera la agenda (`release_booking_schedule`). Antes la reserva quedaba
   `cancelled` con las horas ocupadas para siempre (fuga preexistente, hermana de F5).

**Verificado E2E:**
- Aceptar (servicio 3 h desde 09:00): `availability` 09/10/11 = `false`, **12:00 = `true`**;
  `booking_blocks` = 3 (rango correcto).
- Rechazar: antes 09/10/11 = `false` → después **09/10/11 = `true`**, `booking_blocks` = 0,
  reserva `cancelled`.
- Dinero sin cambios: aceptar → captura; rechazar → PI `canceled`, cliente paga 0.

### F7 — el gate de tipos de la coordinación

`docs/audit/COORDINACION-SERVICIOS.md` §4 actualizado: el gate real es
`npx tsc --noEmit -p tsconfig.app.json` (el de `tsconfig.json` es un no-op: `files: []`).
Criterio: el número **no sube de 173**, y los ficheros que toca cada servicio quedan sin
errores nuevos.

### F2 — no reproducible (confirmado de nuevo)

El trigger `prevent_confirm_when_price_change_pending` sigue impidiendo proponer un cambio de
precio sobre una reserva `confirmed`, así que el escenario "rechazo de cambio de precio sobre
confirmada no reembolsa la comisión capturada" no ocurre. Sin cambios.

---

## 9. Estado del stack de referencia al terminar

- **Esquema/funciones:** idénticos a `origin/main`. `cancel_booking` y
  `respond_booking_price_change` restauradas a su definición previa; las RPC auxiliares de F3
  (`list_bookings_pending_payment_reconciliation`, `mark_booking_payment_settled`) eliminadas.
  Las correcciones viajan en los ficheros de migración y llegan a la BD por el `db push`
  posterior al merge, no por parches sueltos.
- **Datos:** 0 reservas, 0 presupuestos, 0 intentos de pago, 0 reseñas, 0 mensajes de chat,
  0 bloqueos de agenda. Jardinero sembrado `11111111-…` de vuelta a «Nuevo»
  (`rating = NULL`, `rating_average = 0`, `rating_count = 0`). Toda la disponibilidad del
  jardinero reabierta (`availability` y `availability_blocks` sin filas cerradas).
- **Stripe test:** quedan los PaymentIntents del ciclo de pruebas (varias capturas y un
  reembolso). Son objetos del entorno de **test**, aislados, y no se borran.
