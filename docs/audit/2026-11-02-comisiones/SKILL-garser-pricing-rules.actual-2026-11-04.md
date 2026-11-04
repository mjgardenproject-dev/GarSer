---
name: garser-pricing-rules
description: |
  Guardián de las reglas de negocio de precios, rendimientos, activación de servicios,
  filtrado de jardineros y disponibilidad del marketplace GarSer.

  ACTÍVATE SIEMPRE ante cualquier tarea relacionada con: cálculo de precio de un servicio
  (césped, setos, árboles, palmeras, arbustos, desbroce, fitosanitarios), rendimientos
  (yield_m2_per_hour, yield_ml_per_hour, yield_units_per_hour), tarifa horaria
  (precioPorHora) o por cantidad (price_per_m2), precio mínimo (minimum_price), comisión
  / gastos de gestión de la plataforma (cinco reglas configurables por el administrador,
  decididas por SQL, con clave secreta del enlace del profesional, instantáneas inmutables
  y textos de la web que cambian con los ajustes), activación de servicios del jardinero, filtrado en
  ProvidersPage (distancia / disponibilidad / servicio activo), bloqueo de slots de
  calendario (estimatedHours / durationHours), checkout o pagos de reserva, o
  configuración de tarifas en el panel admin.

  Úsala cuando el usuario diga: "modifica el cálculo de precio", "añade un suplemento",
  "cobrar por hora", "slots no se bloquean bien", "precio incorrecto en ProvidersPage",
  "el jardinero no aparece", "filtrado de jardineros disponibles", "cambia la comisión",
  "gastos de gestión", "el cliente del enlace paga", "QR / enlace del profesional",
  "qué dice la web de la comisión".
---

# GarSer — Reglas de Negocio: Precios, Rendimientos y Disponibilidad

Este documento es la fuente de verdad de las reglas de negocio que gobiernan los cálculos
de precios, tiempos y filtrado de jardineros. Lee este documento entero antes de modificar
cualquier archivo relacionado con pricing o disponibilidad.

**Archivos SSOT del motor de precios** (donde se aplican estas reglas):
- `src/shared/bookingQuoteCore.ts` — motor principal (función `buildAuthoritativeBookingQuote`)
- `src/shared/bookingEligibilityCore.ts` — elegibilidad + filtrado (`evaluateOperationalEligibility`)
- `src/domain/pricingEngine.ts` — helpers matemáticos (palmeras, rendimientos)
- `src/domain/pricing/treePruningPricing.ts` — poda de árboles
- `src/utils/hourlyPricing.ts` — resolución de `precioPorHora` y `pricing_method`

**La comisión NO la calcula el motor de precios.** El motor devuelve el precio del servicio
(sin comisión) y la comisión se añade DESPUÉS, en SQL (sección 4). No añadas ni leas un
porcentaje en TypeScript: no hay ninguno.

---

## 1. Regla general: tarifa horaria vs. por cantidad

Cada jardinero elige **uno de dos métodos** para cada servicio:

| Campo BD | Valor | Significado |
|---|---|---|
| `additional_config.pricing_method` | `'per_hour'` | Cobra por hora |
| `additional_config.pricing_method` | `'per_quantity'` | Cobra por unidad/m²/ml |

**Excepción importante: Poda de Árboles** solo admite `per_quantity` (precio fijo por árbol
según banda de tamaño). No existe opción de tarifa horaria en este servicio.

La función canónica que lee el método es `getPricingMethod(config)` en
`src/utils/hourlyPricing.ts`. La tarifa horaria se lee con `getPrecioPorHora(config)`,
que acepta tanto `config.precioPorHora` como el campo legacy `config.hourly_rate`.

---

## 2. Rendimientos: siempre obligatorios

Los rendimientos son **siempre obligatorios** con independencia del método de tarifa elegido.
Sirven para DOS cosas:

1. **Calcular el precio** (cuando `pricing_method = 'per_hour'`):
   `estimatedHours = cantidad / yield → precio = estimatedHours × precioPorHora`

2. **Calcular el tiempo estimado del servicio** (siempre, incluso con `per_quantity`):
   se usa para bloquear los slots de disponibilidad en el calendario.

Si falta cualquier yield relevante para el trabajo solicitado, el motor devuelve
`isEligible: false` con código `'missing_yield_config'` y el jardinero **no aparece** en
ProvidersPage.

---

## 3. Precio mínimo

Todos los servicios tienen un precio mínimo configurable por el jardinero. Se aplica al
precio calculado **siempre** que el resultado sea positivo pero inferior al mínimo:

```
// En bookingQuoteCore.ts línea 1320-1325
const applyMinimumPrice = (calculatedPrice) => {
  const rounded = roundUp(calculatedPrice);
  const gardenerMin = config?.minimum_price ?? config?.minimumPrice ?? config?.importe_minimo ?? 0;
  if (gardenerMin > 0 && rounded > 0 && rounded < gardenerMin) return roundUp(gardenerMin);
  return rounded;
};
```

Campo BD: `additional_config.minimum_price` (algunos servicios usan `minimumPrice` o
`importe_minimo` — el motor los acepta todos).

---

## 4. Comisión de la plataforma («gastos de gestión»): CONFIGURABLE, decidida por SQL

Estado desde 2026-11 (migraciones `20261102130000`, `…140000`, `…150000`, `20261104130000`,
`20261104140000`). **No hay ningún 12,5 % escrito en el código.** El 12,5 % es solo el valor inicial
de una de las cinco reglas, que el administrador cambia en **Admin → Comisiones**.

### 4.1 Qué es y quién la paga
El cliente paga unos gastos de gestión a GarSer **aparte y encima** del precio del servicio; el
profesional cobra el 100 % de su precio (`totalPrice`, IVA incluido) y GarSer no le descuenta nada.
La comisión se calcula sobre el **precio bruto del servicio** (`serviceGrossTotal`, con IVA), tras el
mínimo y los suplementos; nunca sobre el neto ni antes del mínimo.

### 4.2 Las cinco reglas y su prioridad (valores iniciales)
| Regla (`commission_rule`) | Cuándo | Inicial |
|---|---|---|
| `maintenance_visit` | visita de un plan de mantenimiento (**siempre gana**, también para un cliente del enlace) | 3 % |
| `link_repeat` | cliente cuyo origen es el enlace del profesional y que ya contrató antes con él | 0 % |
| `garser_repeat` | cliente captado por GarSer que ya contrató antes con ese profesional | 3 % |
| `link_first` | primera reserva de un cliente que entra por el enlace del profesional **con su clave** | 0 % |
| `garser_first` | primera reserva de un cliente captado por GarSer (todo lo demás) | 12,5 % |

Decisiones del dueño (2026-11-02/04): «ya contrató» = una reserva **completada** con ESE
profesional (por profesional); el origen (`garser`/`provider_link`) se fija en la primera reserva y
no cambia; una comisión calculada por debajo de 0,50 € se cobra a **0,50 €** (mínimo de Stripe) y se
anota `adjustment = 'minimum_charge'`; un 0 % → 0 € → no hay PaymentIntent.

### 4.3 Dónde vive cada cosa
- **Configuración**: tabla `commission_settings` (una fila, versionada) + `commission_settings_history`
  (cada versión para siempre) + `commission_settings_audit`. Solo por RPC de admin (`get/save/list`,
  `is_admin()` dentro de SQL) y desde el servidor. Nadie lee las tablas por REST.
- **Decisión y cuenta** (SQL, céntimos enteros, mitad hacia arriba): `resolve_booking_commission`,
  `apply_commission_to_economics`, `quote_commission_economics`, `commission_snapshot_problem`. Solo
  `service_role`. El navegador **no puede** mandar porcentaje, importe, regla ni «cliente recurrente».
- **Pegamento del servidor**: `src/shared/commissionEngine.ts` (`applyCommission`, lo cargan
  `booking-authority` y `booking-payment`). Sin comisión válida → `503 commission_unavailable`
  recuperable; **jamás** un 0 ni un valor por defecto.
- **Contrato/tipos compartidos**: `src/shared/commissionRules.ts` (códigos, validación de porcentajes,
  `BookingQuoteCommission`, clave del enlace).
- **Importes a mostrar**: `src/shared/bookingAmounts.ts` lee la columna `bookings.management_fee`; nunca
  recalcula.

### 4.4 Instantáneas inmutables
Cada presupuesto firmado y cada reserva guardan `commission_rule`, `commission_rate_bps`,
`commission_base_amount`, `commission_config_version`, `commission_fixed_at`. Cambiar los ajustes
afecta solo a los presupuestos **nuevos**; lo firmado se cobra con lo firmado (se verifica contra
`commission_settings_history`). El pago revalida lo firmado (`commissionMismatch`) y un trigger sobre
`booking_payment_attempts` impide insertar un intento cuyo importe no sea el de la instantánea.

### 4.5 El origen «enlace» lleva CLAVE SECRETA (no basta con el identificador)
El identificador del profesional es público; declarar «vengo del enlace» no prueba nada. El enlace es
`/reservar/<id>?c=<clave de 32 hex>`. La clave la crea y guarda SQL (`provider_booking_links`, sin
acceso directo), la ve solo su profesional (`my_booking_link()`), la cambia con
`rotate_my_booking_link()` y `provider_link_code_matches` la contrasta (sin distinguir mayúsculas).
Sin clave, falsa, de otro profesional o antigua → `linkClaim = 'rejected'` y la reserva paga como
cliente de GarSer. La web la captura de la dirección y la **quita** (Pixel de Meta), la guarda por
profesional (180 días) y la manda como `originLinkCode`. **Todo enlace o QR que se genere debe
llevarla** (`buildProviderBookingUrl`); `useMyBookingLink`/`useMarketingProfile` no dejan generar uno sin ella.

### 4.6 Lo que dice la web de la comisión: TEXTOS QUE CAMBIAN CON LOS AJUSTES
Regla de oro: **la web nunca afirma nada sobre quién paga gastos de gestión que no sea cierto ahora.**
- `get_public_billing_terms()` (anon) devuelve **niveles**, no porcentajes: `none | reduced | standard |
  higher` por regla, relativos a `garser_first`. `src/shared/billingTerms.ts` los lee (estricto) y
  `usePublicBillingTerms` los pide una vez (caché 5 min; reintento a los 30 s tras un error).
- **Todo texto que dependa de quién paga sale de `src/config/billingCopy.ts`** (landing de jardineros,
  FAQ y su JSON-LD, asistente de alta, Marketing). Sin niveles (cargando/error) → textos **neutros**,
  ciertos con cualquier configuración. Probado con las 1024 combinaciones posibles.
- Lo invariante (el profesional no paga y cobra el 100 %) puede ser fijo; lo demás, **nunca** fijo:
  ni SEO, ni portada, ni `index.html`, ni términos legales. Hay una guardia
  (`src/config/publicClaims.test.ts`) que falla si reaparece «sin comisión» o similar en un texto fijo.
- **Nada de gastos de gestión en lo que se imprime o descarga** (flyers, tarjetas, vinilo, QR,
  pie de foto, mensajes para copiar): un papel no se corrige cuando cambian los ajustes (decisión del dueño).
- Admin → Comisiones tiene «Lo que dirá la web» con los porcentajes que se están escribiendo.
- Los textos por reserva salen de los datos de esa reserva (`feeWaiver.reason`, `management_fee`),
  no de los ajustes. Tras cancelar, **no** se afirma «no se te ha cobrado nada»: depende de quién
  cancela y de la antelación (ver 4.7).

### 4.7 Dinero real (Stripe): lo que está verificado
PaymentIntent con `capture_method=manual`; importe = `payable_now_amount_cents` de la instantánea;
se **autoriza** al enviar la solicitud y se **captura** al aceptar el profesional
(`finalize_booking_payment`). Rechaza o caduca (24 h) → se libera. Cliente cancela **con 24 h o
más** (`>= interval '24 hours'`) → íntegro (liberar si no estaba aceptada, reembolso si ya cobrada);
**con menos** → se pierde (una solicitud sin aceptar se **captura**); cancela el profesional tras
aceptar → reembolso + valoración de 1★ del sistema; cambio de precio aceptado → se cobra la MISMA
comisión autorizada, rechazado → se libera. Reembolso con tarjeta: 5–10 días hábiles. Reservas de 0 €:
sin PaymentIntent, `waived_<motivo>`, la web debe saber confirmar sin pago (`clientCapabilities.feeWaiver`).

### 4.8 Cómo se prueba (no te saltes esto al tocar comisiones)
- `node scripts/commissions/pglite-sql-tests.mjs` — migraciones reales + `supabase/tests/commission_settings.test.sql`
  sin Docker. Con Docker, el mismo test contra el Postgres real:
  `docker exec -i <db> psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/commission_settings.test.sql`
  (la base real tiene máquina de estados y privilegios por defecto que PGlite no tiene: pruébalo en las dos).
- `node scripts/commissions/verify-commissions.mjs` — motor + `booking-authority` + creación del PaymentIntent.
- `COMMISSIONS_FUNCTIONS_ENV=<env> node scripts/commissions/verify-commissions-stripe.mjs` — **dinero real
  en modo prueba** (autorizar/capturar/liberar/devolver, webhooks firmados, tarjetas, límites de 24 h,
  cambio de precio, planes, 0,50 €, 100 %, decimales). Necesita `supabase functions serve --env-file`
  con un `STRIPE_WEBHOOK_SECRET` propio de pruebas. **Cuidado**: `supabase functions list`/`secrets`/`db push`
  sin `--local` apuntan a PRODUCCIÓN.
- Cualquier cambio en `bookingQuoteCore.ts` o en el motor **exige redesplegar `booking-authority` y
  `booking-payment`** (ambos lo importan).

### 4.8b Trampas conocidas
- Una reserva a `completed` en las pruebas debe pasar `pending → confirmed → completed`; para fijar el
  dato sin esa cadena, `set session_replication_role = replica`.
- `service_role` recibe `EXECUTE` por privilegios por defecto: si una función debe ser interna, `REVOKE … FROM service_role` a propósito.
- Peticiones de pago simultáneas del mismo presupuesto: un solo PaymentIntent, pero los perdedores
  pueden recibir 502/409 de la idempotencia de Stripe (preexistente; la web reintenta).

---

## 5. Cálculo de tiempo y bloqueo de slots

```
// bookingEligibilityCore.ts línea 196
durationHours = Math.max(1, Math.ceil(quote.estimatedHours))
```

El tiempo total estimado se calcula **con los rendimientos del jardinero concreto**. Nunca
se usa un rendimiento genérico ni el de otro jardinero.

El tiempo bruto puede tener un descuento de eficiencia si supera 8 horas:
```
// bookingQuoteCore.ts línea 1317
if (totalHours > 8) totalHours *= 0.9;
estimatedHours = Math.max(1, Math.ceil(totalHours * 2) / 2)  // redondeo a 0.5h
```

Los slots válidos son aquellas horas de inicio donde existen `durationHours` bloques
consecutivos disponibles (`getValidStartHours` en `bookingEligibilityCore.ts` línea 102).

---

## 6. Activación de servicios: campos obligatorios

Un servicio está **activo** para un jardinero cuando `buildAuthoritativeBookingQuote` puede
calcular un precio > 0 y un tiempo > 0 con su configuración. Las reglas exactas por servicio:

### 6.1 Corte de Césped
Obligatorios siempre:
- `yield_m2_per_hour > 0`
- Si `per_quantity`: `price_per_m2 > 0`
- Si `per_hour`: `precioPorHora > 0`
- `minimum_price` (puede ser 0, no bloquea la activación)

Opcionales (no bloquean activación):
- `condition_surcharges.descuidado`, `condition_surcharges.muy_descuidado`
- `waste_removal.percentage`

### 6.2 Corte de Setos
Obligatorios para los rangos que ofrezca (mínimo `'0-2m'` y `'2-4m'`):
- `pricing_matrix['0-2m'] > 0` y `yield_ml_per_hour['0-2m'] > 0`
- `pricing_matrix['2-4m'] > 0` y `yield_ml_per_hour['2-4m'] > 0`
- Si `per_hour`: `precioPorHora > 0`

**Rango `'4-6m'` (setos altos) — NO obligatorio para activar el servicio**:
- Si el cliente pide setos >4m y el jardinero NO tiene `pricing_matrix['4-6m'] > 0`
  y `yield_ml_per_hour['4-6m'] > 0`, el jardinero **no puede aparecer** para ese trabajo.
- La lógica en `bookingQuoteCore.ts` línea 1143 verifica `pricing_matrix[height]` y
  devuelve `missing_pricing_config` si falta para la altura solicitada.

### 6.3 Poda de Árboles
**Solo `per_quantity`** (precio fijo por árbol). No existe `per_hour` en este servicio.

Obligatorios para los rangos `small` (0-3m) y `medium` (3-5m):
- `config.formacion.small > 0`, `config.formacion.medium > 0`
- `config.estructural.small > 0`, `config.estructural.medium > 0`
- `config.yield_units_per_hour.formacion.small > 0`, `.medium > 0`
- `config.yield_units_per_hour.estructural.small > 0`, `.medium > 0`
- `config.difficultyIncrease` (número, puede ser 0)
- `config.minimumPrice` (puede ser 0)

**Rango `large` (5-9m) — NO obligatorio para activar el servicio**:
- Para poder aceptar árboles de 5-9m o >9m (`over_9`), el jardinero necesita:
  `config.formacion.large > 0` Y `config.yield_units_per_hour.formacion.large > 0`
  (ídem para `estructural.large`).
- Si faltan, `canHandleTree()` en `treePruningPricing.ts` línea 56 devuelve `false` y
  el jardinero es excluido (`isProfessionalSuitable: false`).
- Los árboles `over_9` (>9m) usan el precio y yield de `large`.

### 6.4 Poda de Palmeras
Obligatorios (al menos una especie con todas sus bandas de altura configuradas):
- `config.height_prices[especie][banda] > 0` para cada banda ofertada
- `config.yield_units_per_hour[especie][banda] > 0` para cada banda ofertada
- O bien `per_hour`: `precioPorHora > 0` + `yield_units_per_hour[especie][banda] > 0`
- `config.minimum_price` (puede ser 0)

Si la solicitud incluye una especie o altura que el jardinero no tiene configurada,
`buildPalmQuoteMetadata` marca `isPriced: false` y el resultado es `partial_palm_coverage`.

### 6.5 Poda de Arbustos
Obligatorios por tamaño (`pequeñas`, `medianas`, `grandes`):
- Si `per_quantity`: `config.prices_per_m2[tamaño] > 0` para cada tamaño solicitado
- Si `per_hour`: `precioPorHora > 0`
- `config.yield_m2_per_hour[tamaño] > 0` para cada tamaño solicitado

### 6.6 Desbroce / Eliminación de Malas Hierbas
Obligatorios:
- `config.precio_desbroce_m2 > 0`
- `config.yield_m2_per_hour > 0`
- Si el cliente pide herbicida: `config.precio_herbicida_m2 > 0`

### 6.7 Fitosanitarios
Obligatorios:
- `config.tratamientos_activos.length >= 1`
- Rendimientos (`config.yields.*`) para cada tipo de elemento afectado en la solicitud:
  - Césped → `yields.cesped_m2_per_hour > 0`
  - Setos → `yields.setos_ml_per_hour > 0`
  - Palmeras → `yields.palmeras_units_per_hour > 0`
  - Palmeras (endoterapia) → `yields.endoterapia_units_per_hour > 0`
  - Árboles → `yields.arboles_units_per_hour > 0`
  - Plantas → `yields.plantas_m2_per_hour > 0`
- Tarifas en `config.detailed_pricing` o en las matrices `superficies_plantas`, `setos`,
  `arboles`, `palmeras` para los tratamientos y elementos solicitados.

---

## 7. Fórmulas exactas de precio por servicio

> En todos los casos: `finalPrice = MAX(calculatedPrice, minimum_price)` antes de devolver.
> Redondeo final: `Math.ceil(value)` (siempre hacia arriba al euro entero).

### 7.1 Césped (`lawnZones`)

**Variables del jardinero:**
- `config.price_per_m2` — precio por m² (solo `per_quantity`)
- `config.precioPorHora` — tarifa horaria (solo `per_hour`)
- `config.yield_m2_per_hour` — rendimiento en m²/hora
- `config.condition_surcharges.descuidado` — % recargo estado descuidado
- `config.condition_surcharges.muy_descuidado` — % recargo estado muy descuidado
- `config.waste_removal.percentage` — % recargo por retirada de restos
- `config.minimum_price`

**Multiplicadores de duración** (`getDurationMultiplier` en `bookingQuoteCore.ts:426`):
- Normal: `×1.0`
- Descuidado: `×1.3`
- Muy descuidado: `×1.7`
- Alta dificultad (setos/arbustos): `×1.7`
- Dificultad media: `×1.3`

**Fórmula `per_quantity`** (código `bookingQuoteCore.ts:1396-1411`):
```
Por zona:
  stateMultiplier = 1 + (surcharge_percent / 100)
  wasteMultiplier = wasteRemoval ? 1 + (waste_removal.percentage / 100) : 1
  zoneCost = price_per_m2 × m² × stateMultiplier × wasteMultiplier

totalCost = SUM(zoneCost)
finalPrice = MAX(ceil(totalCost), minimum_price)
```

**Fórmula `per_hour`** (código `pricingEngine.ts:71-76` + `bookingQuoteCore.ts:1335`):
```
Por zona:
  durationMult = getDurationMultiplier(state)  // 1.0 | 1.3 | 1.7
  estimatedHours = (m² / yield_m2_per_hour) × durationMult

totalHours = SUM(estimatedHours por zonas)
// descuento eficiencia >8h: if totalHours > 8 → totalHours *= 0.9
estimatedHours = ceil(totalHours × 2) / 2   // redondeo a 0.5h
totalPrice = MAX(ceil(estimatedHours × precioPorHora), minimum_price)
```

---

### 7.2 Setos (`hedgeZones`)

**Variables del jardinero:**
- `config.pricing_matrix['0-2m']` — €/ml para setos 0-2m
- `config.pricing_matrix['2-4m']` — €/ml para setos 2-4m
- `config.pricing_matrix['4-6m']` — €/ml para setos 4-6m (opcional)
- `config.precioPorHora` — tarifa horaria (solo `per_hour`)
- `config.yield_ml_per_hour['0-2m']` — ml/hora para 0-2m
- `config.yield_ml_per_hour['2-4m']` — ml/hora para 2-4m
- `config.yield_ml_per_hour['4-6m']` — ml/hora para 4-6m (opcional)
- `config.condition_surcharges.media` — % recargo dificultad media (default 20%)
- `config.condition_surcharges.alta` — % recargo dificultad alta (default 50%)
- `config.waste_removal.percentage` — % recargo retirada de restos
- `config.minimum_price`

**Fórmula `per_quantity`** (código `bookingQuoteCore.ts:1354-1372`):
```
Por zona:
  lengthForPricing = zone.length_pricing_m ?? zone.length
  faces = zone.faces_to_trim ?? 1
  base = pricing_matrix[zone.height]          // €/ml
  stateMultiplier = 1 + statePercent / 100    // según estado
  wasteMultiplier = wasteRemoval ? 1 + (waste_removal.percentage / 100) : 1
  zoneCost = base × lengthForPricing × faces × stateMultiplier × wasteMultiplier

totalPrice = MAX(ceil(SUM(zoneCost)), minimum_price)
```

**Fórmula `per_hour`** (código `bookingQuoteCore.ts:1246-1254`):
```
Por zona:
  yieldMl = yield_ml_per_hour[zone.height]
  faces = zone.faces_to_trim ?? 1
  durationMult = getDurationMultiplier(zone.state)
  zoneHours = (length × faces / yieldMl) × durationMult

totalHours = SUM(zoneHours)
// descuento eficiencia >8h aplicado
estimatedHours = ceil(totalHours × 2) / 2
totalPrice = MAX(ceil(estimatedHours × precioPorHora), minimum_price)
```

---

### 7.3 Poda de Árboles (`treeGroups`) — solo `per_quantity`

**Variables del jardinero** (en `config: TreePruningServiceConfig`):
- `config.formacion.small` — €/árbol tipo formación, 0-3m
- `config.formacion.medium` — €/árbol tipo formación, 3-5m
- `config.formacion.large` — €/árbol tipo formación, 5-9m (+ over_9) — OPCIONAL
- `config.estructural.small` — €/árbol tipo estructural, 0-3m
- `config.estructural.medium` — €/árbol tipo estructural, 3-5m
- `config.estructural.large` — €/árbol tipo estructural, 5-9m (+ over_9) — OPCIONAL
- `config.yield_units_per_hour.formacion.small` — árboles/hora para formación 0-3m
- `config.yield_units_per_hour.formacion.medium` — árboles/hora para formación 3-5m
- `config.yield_units_per_hour.formacion.large` — árboles/hora para formación 5-9m (OPCIONAL)
- `config.yield_units_per_hour.estructural.*` — ídem para poda estructural
- `config.difficultyIncrease` — % incremento si el cliente confirma dificultad alta
- `config.wasteRemovalMultiplier` — % recargo retirada de restos
- `config.minimumPrice`

**Fórmula** (código `treePruningPricing.ts:64-145`):
```
Por árbol:
  basePrice = config[pruningType][sizeBand]       // 'large' cubre también over_9
  baseYield = config.yield_units_per_hour[pruningType][sizeBand]
  unitHours = 1 / baseYield

  subtotal = basePrice
  estimatedHours = unitHours

  Si dificultad_alta:
    diffMult = difficultyIncrease / 100
    subtotal += basePrice × diffMult
    estimatedHours += unitHours × diffMult

  Si wasteRemoval:
    wasteMult = wasteRemovalMultiplier / 100
    subtotal += subtotal × wasteMult
    estimatedHours += estimatedHours × wasteMult

totalCalculated = SUM(subtotal por árbol)
totalHours = SUM(estimatedHours por árbol)
totalPrice = MAX(totalCalculated, minimumPrice)
```

> `dificultad_alta` debe venir de **respuesta explícita del cliente**, nunca de la IA.

---

### 7.4 Poda de Palmeras (`palmGroups`)

**Variables del jardinero:**
- `config.height_prices[especie][bandaAltura]` — €/palmera (solo `per_quantity`)
- `config.precioPorHora` — tarifa horaria (solo `per_hour`)
- `config.yield_units_per_hour[especie][bandaAltura]` — palmeras/hora
- `config.condition_surcharges.normal` — % normal (default 0)
- `config.condition_surcharges.descuidado` — % descuidada
- `config.condition_surcharges.muy_descuidado` — % muy descuidada
- `config.waste_removal.percentage` — % retirada de restos
- `config.phytosanitary` — € extra por fitosanitario (si aplica a especie)
- `config.trunk_finish` — % extra por acabado de tronco (si aplica a especie)
- `config.access_difficulty` — % recargo por dificultad de acceso (no en altura mínima)
- `config.minimum_price`

**Fórmula `per_quantity`** (código `pricingEngine.ts:376-441`):
```
Por grupo (especie + altura + quantity):
  basePrice = findPalmPrice(config, especie, altura)  // config.height_prices[e][h]
  stateMult = 1 + (condition_surcharges[estado] / 100)
  wasteMult = wasteRemoval ? 1 + (waste_removal.percentage / 100) : 1

  unitExtra = 0
  Si hasPhytosanitary y especie soporta fitosanitario:
    unitExtra += config.phytosanitary
  Si hasTrunkPeeling y especie soporta peeling:
    unitExtra += (basePrice × stateMult × wasteMult) × (trunk_finish / 100)

  canAccessDiff = altura != banda_mínima_especie
  accessMult = canAccessDiff && hasAccessDifficulty ? 1 + (access_difficulty / 100) : 1

  lineTotal = ((basePrice × stateMult × wasteMult) + unitExtra) × accessMult × quantity

totalCalculated = SUM(lineTotal por grupos)
totalPrice = MAX(totalCalculated, minimum_price)
```

**Fórmula `per_hour`** (código `pricingEngine.ts:327-374`):
```
Por grupo:
  yieldForSpecies = yield_units_per_hour[especie][altura]
  baseHours = quantity / yieldForSpecies
  stateMult = 1 + (condition_surcharges[estado] / 100)
  wasteMult = wasteRemoval ? 1 + (waste_removal.percentage / 100) : 1
  accessMult = (no acceso mínimo && hasAccessDifficulty) ? 1 + (access_difficulty / 100) : 1
  groupHours = baseHours × stateMult × wasteMult × accessMult

totalHours = SUM(groupHours)
// factores de eficiencia NO se aplican en per_hour con yield configurado
estimatedHours = ceil(totalHours × 2) / 2
totalPrice = MAX(ceil(estimatedHours × precioPorHora), minimum_price)
```

---

### 7.5 Poda de Arbustos (`shrubGroups`)

**Variables del jardinero:**
- `config.prices_per_m2['pequeñas']` — €/m² arbustos pequeños
- `config.prices_per_m2['medianas']` — €/m² arbustos medianos
- `config.prices_per_m2['grandes']` — €/m² arbustos grandes
- `config.precioPorHora` — tarifa horaria (solo `per_hour`)
- `config.yield_m2_per_hour['pequeñas']` — m²/hora por tamaño (ídem para otras)
- `config.condition_surcharges.media` — % recargo dificultad media (default 20%)
- `config.condition_surcharges.alta` — % recargo dificultad alta (default 50%)
- `config.waste_removal.percentage`
- `config.minimum_price`

**Fórmula `per_quantity`** (código `bookingQuoteCore.ts:1415-1430`):
```
Por grupo:
  pricePerM2 = prices_per_m2[group.size]
  statePercent = (muy_descuidado → alta%) | (descuidado → media%) | 0
  stateMultiplier = 1 + statePercent / 100
  wasteMultiplier = wasteRemoval ? 1 + (waste_removal.percentage / 100) : 1
  groupCost = area × pricePerM2 × stateMultiplier × wasteMultiplier

totalPrice = MAX(ceil(SUM(groupCost)), minimum_price)
```

**Fórmula `per_hour`** (análoga a césped, usando `yield_m2_per_hour[size]`).

---

### 7.6 Desbroce (`weedingZones`)

**Variables del jardinero:**
- `config.precio_desbroce_m2` — €/m² base
- `config.precio_herbicida_m2` — €/m² herbicida adicional (si cliente lo pide)
- `config.yield_m2_per_hour` — m²/hora
- `config.suplementos.dificultad_media` — % recargo dificultad media
- `config.suplementos.dificultad_alta` — % recargo dificultad alta
- `config.suplementos.retirada_restos` — % recargo retirada de restos
- `config.importe_minimo`

**Fórmula** (código `bookingQuoteCore.ts:661-695`):
```
Por zona:
  base = area × precio_desbroce_m2
  herbicide = applyHerbicide ? area × precio_herbicida_m2 : 0
  statePercent = (alta → dificultad_alta%) | (media → dificultad_media%) | 0
  stateMultiplier = 1 + statePercent / 100
  wasteMultiplier = wasteRemoval ? 1 + (retirada_restos / 100) : 1
  zoneCost = (base + herbicide) × stateMultiplier × wasteMultiplier
  zoneHours = (area / yield_m2_per_hour) × stateMultiplier × wasteMultiplier

totalPrice = MAX(ceil(SUM(zoneCost)), importe_minimo)
```

---

### 7.7 Fitosanitarios (`phytosanitaryZones`)

**Variables del jardinero:**
- `config.tratamientos_activos[]` — lista de tratamientos activos que ofrece
- `config.detailed_pricing.cesped.preventivo/curativo` — €/m²
- `config.detailed_pricing.setos.bajos_preventivo/bajos_curativo/altos_preventivo/altos_curativo` — €/ml
- `config.detailed_pricing.palmeras.*` — €/ud por tamaño y tipo
- `config.detailed_pricing.arboles.*` — €/ud por tamaño
- `config.detailed_pricing.plantas.*` — €/m² por tamaño
- `config.palmeras.endoterapia.precio_unico` — €/ud endoterapia
- `config.pricing_modifiers.eco.percentage` — % recargo si ecológico
- `config.pricing_modifiers.combo.two_treatments_percentage` — % recargo 2 tratamientos
- `config.pricing_modifiers.combo.three_plus_treatments_percentage` — % recargo ≥3 tratamientos
- `config.yields.cesped_m2_per_hour`, `.setos_ml_per_hour`, `.palmeras_units_per_hour`,
  `.endoterapia_units_per_hour`, `.arboles_units_per_hour`, `.plantas_m2_per_hour`
- `config.minimum_fee` (o `importe_minimo`)

**Fórmula** (código `bookingQuoteCore.ts:802-1007`):
```
Por zona (con métricas detalladas de IA):
  subtotal = SUM(cantidad_elemento × precio_elemento según detailed_pricing)
  ecoMult = requestedTreatments.includes('ecologico_preventivo') ? 1 + (eco.percentage/100) : 1
  comboPercent = (treatments ≥ 3 → three_plus%) | (treatments == 2 → two%) | 0
  comboMult = 1 + comboPercent / 100
  lineTotal = subtotal × ecoMult × comboMult

totalBeforeMinimum = SUM(lineTotal)
total = MAX(ceil(totalBeforeMinimum), minimum_fee)
```

---

## 8. Filtrado en ProvidersPage

Un jardinero **aparece** en ProvidersPage si y solo si cumple **los tres** requisitos:

### 8.1 Servicio activo (`providerConfig != null`)
El motor lee `gardener_service_prices.additional_config` como JSON. Si es null o el
`buildAuthoritativeBookingQuote` devuelve `isEligible: false`, el jardinero se excluye
con código `'inactive_service'` o el código de fallo concreto del motor.

### 8.2 Dentro del radio operativo
```
// bookingEligibilityCore.ts:70-82
distanceKm = haversine(providerCoords, clientCoords)
if distanceKm > profile.max_distance → excluido ('outside_coverage')
```
Coordenadas del jardinero: `gardener_profiles.operational_latitude/longitude`.
Radio: `gardener_profiles.max_distance` (km).

### 8.3 Disponibilidad con huecos consecutivos suficientes
```
// bookingEligibilityCore.ts:196-210
durationHours = MAX(1, ceil(quote.estimatedHours))
validHours = getValidStartHours(providerDates[requestedDate], durationHours)
// getValidStartHours: horas donde [h, h+1, ..., h+durationHours-1] todas disponibles
if validHours is empty → excluido ('no_reservable_availability')
```
Los bloques de disponibilidad vienen de la tabla `booking_availability_blocks`.

### 8.4 Casos especiales de exclusión parcial
- **Setos >4m**: el jardinero aparece en general para setos, pero si la solicitud incluye
  setos >4m y no tiene `pricing_matrix['4-6m']` y `yield_ml_per_hour['4-6m']`, la llamada
  a `buildAuthoritativeBookingQuote` devuelve `missing_pricing_config` → excluido para ese
  trabajo concreto.
- **Árboles >5m**: si `canHandleTree()` devuelve `false` → `isProfessionalSuitable: false`
  → excluido con `invalid_tree_config`.
- **Palmeras sin cobertura total**: si algún grupo de palmeras solicitado no tiene precio
  configurado → `partial_palm_coverage` → excluido.

---

## 9. Precio mostrado al cliente en ProvidersPage

El motor devuelve `totalPrice` (precio del profesional, bruto con IVA) y `economics` **ya con la
comisión que le toca a ESE cliente con ESE profesional** (la añade `booking-authority` llamando a SQL):

```
economics.managementFee  → gastos de gestión (0 si la regla da 0 %)
economics.payableNow     → lo que se paga ahora (= managementFee)
economics.commission     → { rule, rateBps, configVersion, origin, claimedOrigin, linkClaim, isFirstBooking,
                             baseAmount, calculatedAmount, amount, adjustment }
economics.feeWaiver      → { reason } solo si es 0 € (provider_link | returning_client | maintenance_plan | zero_commission)
precioVisibleCliente     = totalPrice + managementFee      // NO se multiplica por 1,125
```

El desglose del checkout sale de `getQuoteAmounts` / `getBookingAmounts` (`bookingAmounts.ts`):
- Subtotal neto `serviceGrossTotal / 1,21` e IVA (si procede).
- Gastos de gestión: el importe firmado, o «Sin gastos de gestión» con su motivo si es 0 €.
- Total = servicio + gastos. Lo que se **paga ahora** son solo los gastos; el servicio se paga al profesional.

---

## 10. Suplementos y servicios extra configurables por el jardinero

**Regla absoluta:** Todo suplemento o servicio extra que el jardinero haya configurado
**debe influir en el precio final** cuando el cliente lo solicita. Ningún suplemento puede
ignorarse aunque su porcentaje sea pequeño. Son parte de la promesa económica del jardinero
y del contrato con el cliente.

Los suplementos se configuran en el panel del jardinero y se almacenan en
`gardener_service_prices.additional_config`. Su aplicación ocurre dentro de
`buildAuthoritativeBookingQuote` en `src/shared/bookingQuoteCore.ts`.

---

### 10.1 Corte de Césped — suplementos

| Campo en `additional_config` | Tipo | Cuándo aplica | Cómo se aplica al precio |
|---|---|---|---|
| `condition_surcharges.descuidado` | % | Estado del jardín = descuidado | `precio × (1 + %/100)` |
| `condition_surcharges.muy_descuidado` | % | Estado = muy descuidado | `precio × (1 + %/100)` |
| `waste_removal.percentage` | % | Cliente solicita retirada de restos | `precio × (1 + %/100)` |

Los suplementos de estado también multiplican el **tiempo estimado** (mismo multiplicador).
Los tres campos son **obligatorios en config** aunque el cliente no los active.

Fórmula completa por zona (código `bookingQuoteCore.ts:1399-1410`):
```
stateMult  = 1 + (surcharge_descuidado_o_muy_descuidado / 100)
wasteMult  = wasteRemoval ? 1 + (waste_removal.percentage / 100) : 1
zoneCost   = price_per_m2 × m² × stateMult × wasteMult
```

---

### 10.2 Corte de Setos — suplementos

| Campo en `additional_config` | Tipo | Cuándo aplica | Cómo se aplica |
|---|---|---|---|
| `condition_surcharges.media` | % | Dificultad de corte media | `precio × (1 + %/100)` |
| `condition_surcharges.alta` | % | Dificultad de corte alta | `precio × (1 + %/100)` |
| `waste_removal.percentage` | % | Cliente solicita retirada | `precio × (1 + %/100)` |
| `faces_to_trim` (dato cliente) | ud | Nº de caras del seto | `precio × faces` (multiplicador lineal) |

Los tres suplementos son **obligatorios en config** (con valores por defecto 20%/50%).
El número de caras (`zone.faces_to_trim`) multiplica tanto el precio como las horas.

Fórmula completa por zona (código `bookingQuoteCore.ts:1354-1372`):
```
base       = pricing_matrix[height]              // €/ml
stateMult  = 1 + (statePercent / 100)           // media o alta
wasteMult  = wasteRemoval ? 1 + (waste_removal.percentage / 100) : 1
zoneCost   = base × length_pricing_m × faces_to_trim × stateMult × wasteMult
```

---

### 10.3 Poda de Árboles — suplementos

| Campo en `additional_config` | Tipo | Cuándo aplica | Cómo se aplica |
|---|---|---|---|
| `difficultyIncrease` | % | `dificultad_alta = true` (respuesta explícita cliente) | `subtotal += basePrice × (difficultyIncrease/100)` |
| `wasteRemovalMultiplier` | % | Cliente solicita retirada | `subtotal += subtotal × (wasteRemovalMultiplier/100)` |

Ambos campos son **obligatorios en config** aunque sean 0.
La dificultad se aplica **antes** que la retirada de restos. Ambos también afectan las horas estimadas
con el mismo multiplicador (código `treePruningPricing.ts:98-111`):

```
Si dificultad_alta:
  subtotal += basePrice × (difficultyIncrease / 100)
  estimatedHours += unitHours × (difficultyIncrease / 100)

Si wasteRemoval:
  subtotal += subtotal × (wasteRemovalMultiplier / 100)
  estimatedHours += estimatedHours × (wasteRemovalMultiplier / 100)
```

**Nota crítica:** `dificultad_alta` viene de respuesta explícita del cliente POR ÁRBOL,
nunca de la IA. La IA puede sugerir complejidad pero no puede activar el recargo
(`treePruningPricing.ts:97`).

---

### 10.4 Poda de Palmeras — suplementos y servicios extra

| Campo en `additional_config` | Tipo | Cuándo aplica | Cómo se aplica |
|---|---|---|---|
| `condition_surcharges.descuidado` | % | Estado = descuidado | `basePrice × (1 + %/100)` |
| `condition_surcharges.muy_descuidado` | % | Estado = muy descuidado | `basePrice × (1 + %/100)` |
| `waste_removal.percentage` | % | Cliente solicita retirada | `precio × (1 + %/100)` |
| `phytosanitary` | € fijo/ud | `hasPhytosanitary = true` Y especie soporta fitosanitario | `unitExtra += phytosanitary` |
| `trunk_finish` | % | `hasTrunkPeeling = true` Y especie soporta peeling | `unitExtra += currentValue × (trunk_finish/100)` |
| `access_difficulty` | % | `hasAccessDifficulty = true` Y NO es la banda de altura mínima de la especie | `lineTotal × (1 + access_difficulty/100)` |

Orden de aplicación (código `pricingEngine.ts:400-436`):
```
stateMult     = 1 + (condition_surcharges[estado] / 100)
wasteMult     = wasteRemoval ? 1 + (waste_removal.percentage / 100) : 1
currentValue  = basePrice × stateMult × wasteMult

unitExtra = 0
Si hasPhytosanitary (y especie la soporta):
  unitExtra += phytosanitary                          // € plano
Si hasTrunkPeeling (y especie lo soporta):
  unitExtra += currentValue × (trunk_finish / 100)   // % sobre subtotal ya ajustado

canAccessDiff = (height != bandaMínimaEspecie)
accessMult = canAccessDiff && hasAccessDifficulty ? 1 + (access_difficulty / 100) : 1

lineTotal = (currentValue + unitExtra) × accessMult × quantity
```

**Bandas mínimas por especie** (donde NO aplica `access_difficulty`):
- Phoenix canariensis: `'0-4'`
- Phoenix dactylifera: `'0-5'`
- Washingtonia robusta/filifera: `'0-4'`
- Syagrus romanzoffiana: `'0-5'`
- Trachycarpus fortunei: `'0-3'`
- Roystonea regia: `'0-6'`

Los campos `phytosanitary`, `trunk_finish` y `access_difficulty` son opcionales para
configurar (pueden ser 0), pero si tienen valor > 0 **deben aplicarse** cuando el cliente
los activa.

---

### 10.5 Poda de Arbustos — suplementos

| Campo en `additional_config` | Tipo | Cuándo aplica | Cómo se aplica |
|---|---|---|---|
| `condition_surcharges.media` | % | Estado muy descuidado | `precio × (1 + alta%/100)` |
| `condition_surcharges.alta` | % | Estado descuidado | `precio × (1 + media%/100)` |
| `waste_removal.percentage` | % | Cliente solicita retirada | `precio × (1 + %/100)` |

> **Ojo con los nombres:** en arbustos el campo `media` corresponde a estado descuidado y
> el `alta` a muy descuidado — los valores por defecto son 20% y 50% respectivamente.
> Código `bookingQuoteCore.ts:435-451`: si state incluye 'muy' → usa `surcharges.alta`,
> si incluye 'descuidado' → usa `surcharges.media`.

---

### 10.6 Desbroce — suplementos y servicios extra

| Campo en `additional_config` | Tipo | Cuándo aplica | Cómo se aplica |
|---|---|---|---|
| `precio_herbicida_m2` | €/m² | `applyHerbicide = true` (cliente lo activa) | `herbicide = area × precio_herbicida_m2` |
| `suplementos.dificultad_media` | % | Dificultad media | `(base + herbicide) × (1 + %/100)` |
| `suplementos.dificultad_alta` | % | Dificultad alta | `(base + herbicide) × (1 + %/100)` |
| `suplementos.retirada_restos` | % | Cliente solicita retirada | `total × (1 + %/100)` |

El herbicida requiere **licencia fitosanitaria aprobada** del jardinero. Si el jardinero
activa este precio, el sistema lo almacena pero solo lo oferta si tiene licencia válida.

El suplemento de dificultad y retirada de restos se aplican **sobre la suma** de
`base + herbicide` (código `bookingQuoteCore.ts:687`):
```
zoneCost = (area × precio_desbroce_m2 + herbicide) × stateMultiplier × wasteMultiplier
```

Los tres campos de suplementos son **obligatorios en config** para activar el servicio.

---

### 10.7 Fitosanitarios — modificadores de precio

| Campo en `additional_config` | Tipo | Cuándo aplica | Cómo se aplica |
|---|---|---|---|
| `pricing_modifiers.eco.percentage` | % | Tratamiento ecológico preventivo seleccionado | `subtotal × (1 + %/100)` |
| `pricing_modifiers.combo.two_treatments_percentage` | % | 2 tratamientos simultáneos | `subtotal × (1 + %/100)` |
| `pricing_modifiers.combo.three_plus_treatments_percentage` | % | 3 o más tratamientos | `subtotal × (1 + %/100)` |

Los modificadores eco y combo son **mutuamente excluyentes** en la implementación actual:
se aplica eco si hay tratamiento ecológico, y combo según el número de tratamientos,
pero ambos multiplicadores pueden coincidir en la misma zona.

Código `bookingQuoteCore.ts:896-902`:
```
ecoMult   = ecoApplied ? 1 + (eco.percentage / 100) : 1
comboPerc = treatments >= 3 ? three_plus% : treatments == 2 ? two% : 0
comboMult = 1 + comboPercent / 100
lineTotal = subtotal × ecoMult × comboMult
```

---

### 10.8 Regla de aplicación: orden de suplementos

Cuando hay varios suplementos activos para una zona, el orden de aplicación importa
porque los multiplicadores se encadenan. El patrón estándar del motor es:

```
1. Precio base (por m², ml, unidad o yield×hora)
2. × multiplicador de estado (descuidado / dificultad)
3. × multiplicador de retirada de restos
4. + servicios extra fijos (fitosanitario palmeras, herbicida desbroce)
5. × multiplicador de acceso difícil (solo palmeras)
6. × quantity (nº de unidades del grupo)
7. SUMA de todas las zonas/grupos
8. MAX(suma, minimum_price)   ← precio mínimo siempre al final
9. + gastos de gestión (comisión configurable, SQL)  ← solo para el precio visible al cliente
```

Este orden **no puede invertirse**. El precio mínimo siempre es la última operación
antes de añadir la comisión. Nunca se aplica el mínimo por zona, sino sobre el total.

---

## 11. Checklist antes de modificar código de precios

Antes de hacer cualquier cambio en el motor de precios o disponibilidad, verifica:

- [ ] ¿El cambio aplica a todos los jardineros o solo al seleccionado?
  → Toda la lógica usa `config` del jardinero concreto. No hay valores globales de precio.

- [ ] ¿Los rendimientos siguen siendo obligatorios tras el cambio?
  → Si añades un servicio nuevo, debe tener validación de yield en `buildAuthoritativeBookingQuote`.

- [ ] ¿El precio mínimo se sigue aplicando al final, después de todos los suplementos?
  → Siempre usar `applyMinimumPrice()` como última operación antes de retornar.

- [ ] ¿Has tocado algo de comisiones? → Léete la sección 4 entera. La comisión se decide en SQL sobre
  el **precio bruto** (tras mínimos y suplementos); no hay porcentajes en TypeScript; los textos que
  hablan de quién paga salen de `billingCopy.ts`; los enlaces/QR llevan la clave; lo impreso no habla
  de gastos de gestión; y hay que pasar los verificadores de 4.8 (incluido Stripe de pruebas) y
  **redesplegar `booking-authority` y `booking-payment`**.

- [ ] ¿El tiempo estimado usa los rendimientos del jardinero concreto, no valores hardcoded?
  → `durationHours` viene de `quote.estimatedHours` que usa `config.yield_*`.

- [ ] ¿Los slots se bloquean con `ceil(estimatedHours)` horas consecutivas?
  → `getValidStartHours(hours, Math.max(1, Math.ceil(estimatedHours)))`.

- [ ] Para setos >4m / árboles >5m: ¿el jardinero sin esos rangos queda excluido solo
  para esos trabajos, no para todos los setos/árboles?
  → La exclusión es por work-request, no por servicio completo.

- [ ] ¿Has actualizado la configuración del jardinero en el panel admin si añades campos?
  → Los nuevos campos deben almacenarse en `gardener_service_prices.additional_config` (JSONB).

- [ ] ¿Todos los suplementos configurados por el jardinero se aplican cuando el cliente los activa?
  → Ver sección 10. Ningún suplemento puede ignorarse (estado, dificultad, retirada de restos,
     herbicida, fitosanitario palmeras, acabado tronco, acceso difícil, modificadores combo/eco).

- [ ] ¿El orden de aplicación de suplementos es correcto?
  → base → estado → residuos → extras fijos → acceso → qty → MIN → comisión (SQL, sección 4).
  → El precio mínimo siempre es la ÚLTIMA operación antes de la comisión, nunca por zona.
