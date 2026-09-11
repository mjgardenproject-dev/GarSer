# Preparación para producción — Poda de palmeras

**Veredicto de la Fase 2 (2026-09-12, antes de corregir): NO-GO.**
**Estado tras la Fase 3 (2026-09-12, mismo día, autorizada por el usuario): los 4
hallazgos están corregidos y verificados — ver §9. Pendiente de PR, merge y despliegue
antes de que el GO sea real en producción.**

**Lo que sigue de aquí para abajo (§1-§8) es el informe de la Fase 2, tal cual se
presentó antes de corregir** — se deja intacto porque es la evidencia del "papel vs.
realidad" que justificó cada fix. El cierre de la Fase 3, con la verificación de cada
corrección, está en §9.

Auditoría en dos rondas: la Ronda 1 (2026-09-11) cubrió Fase 1 y Fase 2A/2B por completo,
pero un bloqueo del entorno de navegador interrumpió la Fase 2C a mitad. La Ronda 2
(2026-09-12) repitió y completó toda la Fase 2C pendiente (excepto 2B, que sigue sin fotos
de muestra) y encontró un **cuarto hallazgo Bloqueante**, más grave que los tres de la
Ronda 1: el cambio de precio de palmeras está completamente roto.

Tres hallazgos **Bloqueantes** y uno **Grave**, todos propios de palmeras, sin corregir
(mandato explícito: solo auditar en esta sesión — el usuario decide el turno de Fase 3):

1. **El cambio de precio de palmeras es imposible, siempre, incluso en el único caso para
   el que existe** (banda terminal abierta). La función SQL que lo autoriza busca la
   marca de "banda terminal" en una ruta y un formato de clave (`pricing_context->'palm_groups'`,
   `is_terminal_open_range` en snake_case) que no es donde el motor la guarda de verdad
   (`pricing_context.quote_snapshot.metadata.pricingContext.palmGroups[].isTerminalOpenRange`,
   camelCase, cuatro niveles más adentro). El resultado: la condición nunca es cierta, y
   **todo intento de proponer un nuevo precio en una palmera de rango abierto es
   rechazado**, con un mensaje que además ENGAÑA al jardinero diciéndole que su palmera
   "no está en el último rango abierto" cuando sí lo está.
2. **El pelado de tronco y el tratamiento fitosanitario suben el precio pero no las
   horas.** El calendario bloquea menos tiempo del que el jardinero necesita de verdad.
3. **Ningún aviso de plausibilidad para `quantity` en `palmGroups`, ni en el motor ni en
   el flujo de fotos.** 500 palmeras en un solo grupo se facturan y agendan sin ningún
   aviso, y el stepper del flujo de fotos no tiene techo (a diferencia de árboles y del
   propio flujo manual de palmeras).

Un hallazgo **Grave**: el configurador del jardinero autoguarda `selected_species: []` a 1
segundo de abrirlo, sin que el jardinero toque nada, mostrando "sin especies" pese a tener
las 6 configuradas y con precio correcto.

Rama: `auditoria/palmeras`, sobre `origin/main` @ `bd13987` (0 commits de diferencia).
`serviceId` real: `8e5a99f5-5ab5-40c7-b4f3-a9272c08f47e` — el de `references/servicios.md`
es fantasma.

**Lo que la Ronda 2 sí confirmó que funciona bien**, con evidencia end-to-end (pago real,
Stripe, BD): el wizard manual completo, el listado de jardineros, el pago con tarjeta de
test, la aceptación de la reserva por el jardinero, y —el hallazgo más útil en positivo—
**la cancelación de una reserva ya confirmada y ya cobrada emite un reembolso real de
Stripe**, algo que ninguna auditoría anterior había verificado (quedaba anotado como
pendiente en `COORDINACION-SERVICIOS.md` §3.1-A). Ver §5.

---

## 1. Hallazgos

| # | Severidad | Dimensión | Fase | Ubicación | Qué falla | Fix propuesto |
|---|---|---|---|---|---|---|
| 4 | **Bloqueante** | Ciclo de vida (cambio de precio) | 2C (navegador + SQL + logs de consola, reproducido en vivo, Ronda 2) | `supabase/migrations/20260506121000_palm_terminal_range_price_change_guards.sql`, función `propose_booking_price_change`, bloque `IF v_is_palm_service THEN …` | La función lee `v_booking.pricing_context->'palm_groups'` buscando elementos con `is_terminal_open_range = true`. Pero lo que de verdad se guarda en `bookings.pricing_context` (verificado por SQL) es `pricing_context.quote_snapshot.metadata.pricingContext.palmGroups[].isTerminalOpenRange` — ruta distinta y `camelCase` en vez de `snake_case`. `elem->>'is_terminal_open_range'` es `NULL` siempre, `COALESCE(NULL, false) = false` siempre, así que `v_has_terminal_open_range` es **siempre falso**, para cualquier palmera, esté o no en su banda terminal. Reproducido con una reserva real de Phoenix canariensis `>10m` (banda terminal confirmada: el propio flujo mostró el aviso `palm_terminal_range` al cliente, y `pricing_context` de la reserva tiene `isTerminalOpenRange: true`). El jardinero rellena el nuevo precio, pulsa "Proponer", y la petición `POST .../rpc/propose_booking_price_change` devuelve `400`: `{code: P0001, message: "No se permite proponer cambio de precio en palmeras fuera del último rango abierto de la especie."}` — un mensaje **falso** para este caso exacto. Es la única vía de corrección de precio que el producto ofrece para las bandas abiertas (`>10m`, `>15m`, `>20m`, `>6m` según especie, deliberadamente aproximadas porque no hay tope superior), y está completamente inutilizada. | Dentro del bloque `IF v_is_palm_service THEN`, corregir la ruta de lectura a `v_booking.pricing_context->'quote_snapshot'->'metadata'->'pricingContext'->'palmGroups'` y la clave a `isTerminalOpenRange` (camelCase), coherente con lo que `buildPalmQuoteMetadata` (`bookingQuoteCore.ts`) escribe de verdad. Contenido en el bloque palmeras de esta función; no toca el resto de `propose_booking_price_change` ni otros servicios. |
| 1a | Bloqueante | Cálculo de tiempo | 2A (local, evidencia JSON) | `src/domain/pricingEngine.ts`, `calculatePalmHoursFromConfig` (no lee `hasTrunkPeeling`) vs. `calculatePalmPriceEngine` (sí aplica `trunk_finish` al precio) | El pelado de tronco (`trunk_finish`, % configurado por el jardinero) sube el precio pero no se refleja en absoluto en `calculatePalmHoursFromConfig`. Verificado: Washingtonia 4-12 ×2 sin tronco → 170 €/2,5 h; con tronco → 204 €/2,5 h (mismas horas, +34 € de trabajo que no se agenda). | Dentro de `calculatePalmHoursFromConfig`, multiplicar por un `trunkMult` análogo al que ya calcula el precio cuando `hasTrunkPeeling` está activo y la especie lo admite (`canApplyTrunkPeeling`) — mismo patrón que el resto de multiplicadores de la función (`stateMult`, `wasteMult`, `accessMult`). |
| 1b | Bloqueante | Cálculo de tiempo | 2A (local, evidencia JSON) | `src/domain/pricingEngine.ts`, `calculatePalmHoursFromConfig` (no lee `hasPhytosanitary`) vs. `calculatePalmPriceEngine` (sí suma `phytosanitary` € al precio) | El tratamiento fitosanitario (precio fijo €/ud) sube el precio pero no añade ningún tiempo a la duración estimada. Verificado: mismo grupo sin fito → 170 €/2,5 h; con fito → 206 €/2,5 h (mismas horas, +36 € de trabajo — aplicar un tratamiento fitosanitario real no es instantáneo). | Añadir un tiempo fijo por unidad (p. ej. una constante `PALM_PHYTOSANITARY_TIME_HOURS`, a decidir con el usuario cuál) cuando `hasPhytosanitary` está activo y la especie lo admite — no un porcentaje: aplicar el tratamiento tarda lo mismo con independencia del precio de la palmera. |
| 2 | Bloqueante | Coherencia con la vida real | 2A (local, evidencia JSON) + 2C (lectura de código) | Ausente en `src/shared/bookingQuoteCore.ts` (bloque `if (palmGroups.length)`, ~:1328) — no existe ningún `PALM_MAX_PLAUSIBLE_*` ni `pushWarning` para `quantity`. Techo de UI ausente en `src/pages/reserva/DetailsPage.tsx:1543-1550` (`handlePalmQuantityChange` solo tiene `Math.max(1, …)`, sin `Math.min`). | Ninguna capa —ni el motor, ni el stepper del flujo de fotos— limita cuántas palmeras puede declarar un cliente en un solo grupo. Verificado: 500 palmeras en un grupo → `{"totalPrice":45000,"estimatedHours":562.5,"warnings":[]}`, sin ningún aviso. Comparar con césped (`lawn_area_implausible`) y setos (`hedge_length_implausible`), y con árboles (tope 20 en `MANUAL_RANGES.tree.quantity.max`). El propio flujo manual de palmeras SÍ tiene tope (50, `MANUAL_RANGES.palm.quantity.max`) — la asimetría es solo entre "manual" (topado) y "fotos" (sin techo en ningún sitio). | (a) Añadir `pushWarning('palm_quantity_implausible', …)` en el bloque de palmeras de `bookingQuoteCore.ts` cuando `quantity` de un grupo supere un umbral a decidir (p. ej. 20-30); (b) aplicar el mismo `Math.min(MANUAL_RANGES.palm?.quantity?.max ?? N, …)` que ya usa el stepper de árboles en `handlePalmQuantityChange`. |
| 3 | Grave | Configuración del jardinero / Persistencia | 2C (navegador, reproducido en vivo con evidencia SQL antes/después, Ronda 1) | `src/components/gardener/PalmPricingConfigurator.tsx:126-137` (migración de `selected_species`, solo mira `species_prices`) + `src/hooks/useAutoSave.ts` (autoguardado a 1 s por `deepEqual` contra un objeto de forma distinta) | Si `additional_config.selected_species` no existe (el caso del jardinero sembrado — sus precios reales viven en `height_prices`, no en `species_prices`, que están todos a 0 por defecto), la migración automática de especies activas mira `species_prices`, encuentra todo a 0, y deja `selected_species = []`. `useAutoSave` guarda a 1 segundo de abrir el panel **sin que el jardinero toque nada**. Reproducido en vivo: `additional_config` pasó de no tener `selected_species` a tenerla como `[]` en ~1s (SQL antes/después), con "✓ Guardado" visible sin acción y "No hay especies de palmeras seleccionadas." pese a que `height_prices` sigue intacto con las 6 especies reales. Riesgo de segundo orden verificado: re-añadir una especie ya configurada muestra sus precios en blanco en pantalla (la validación bloquea guardar ese estado a medio rellenar, confirmado por SQL). | Hacer que la migración de especies activas también considere "activada" una especie cuando ya tiene datos reales en `height_prices` — mismo tipo de fix que setos aplicó a su hallazgo #2 análogo. |

Los cuatro hallazgos son propios de palmeras: los fixes propuestos caben enteros dentro de
`pricingEngine.ts`/`bookingQuoteCore.ts` (bloque de palmeras), la migración del bloque
`IF v_is_palm_service` de `propose_booking_price_change`, `DetailsPage.tsx` (stepper de
palmeras) o `PalmPricingConfigurator.tsx` — ninguno toca código ni configuración de otro
servicio. Ver §7 para lo que sí es transversal.

## 2. Papel vs. realidad

Config real del jardinero sembrado (verificada por SQL contra `origin/main`):
`pricing_method: per_quantity`, `height_prices`/`yield_units_per_hour` con 21
combinaciones especie×banda (6 especies), `condition_surcharges: {normal: 0, descuidado:
20, muy_descuidado: 50}`, `waste_removal.percentage: 15`, `phytosanitary: 18` (€
plano/ud), `trunk_finish: 20` (%), `access_difficulty: 25` (%), `minimum_price: 60`.

| Escenario | Predicción Fase 1 (papel, recalculada contra el código actual) | Devuelto por el motor (2A) | Mostrado en pantalla (2C, Ronda 2) | Desviación |
|---|---|---|---|---|
| S1 base: Phoenix canariensis 4-10, normal, ×2, sin retirada, sin fito | 180,00 € · 2,5 h | 180,00 € · 2,5 h | **180,00 € al profesional · 2,5 h · 202,50 € total · 22,50 € gastos de gestión** (wizard manual → pago real → `bookings.total_price=180.00`, `management_fee=22.50`) | — |
| S6 terminal Phoenix canariensis >10, normal, ×1, sin extras | 150,00 € · 2,0 h + aviso `palm_terminal_range` | 150,00 € · 2,0 h + aviso | **150,00 € al profesional · 2 h · 168,75 € total** + aviso "Precio aproximado: en el rango más alto…" mostrado literalmente al cliente | — |
| S2 mínimo: Trachycarpus fortunei 0-3, normal, ×1 (35 € teóricos) | 60,00 € · 1,0 h | 60,00 € · 1,0 h | (no repetido en pantalla en Ronda 2; ya PASA en 2A) | — |
| S3 estado: Phoenix canariensis 4-10, muy_descuidado, ×2 | 270,00 € · 4,0 h | 270,00 € · 4,0 h | (no repetido en pantalla) | — |
| Extremo (hallazgo #2): 500 palmeras, Phoenix canariensis 4-10 | (sin aviso definido — no existe) | `{"totalPrice":45000,"estimatedHours":562.5,"warnings":[]}` | no probado en pantalla (motor ya lo confirma) | **Sin aviso de plausibilidad — hallazgo #2** |

Las cifras que muestra la pantalla al cliente (wizard manual → confirmación → pago)
coinciden al céntimo y a la décima de hora con lo que predice la Fase 1 y devuelve el
motor en 2A, para los dos escenarios ejecutados de punta a punta con dinero real
(`pi_3UEche2MwFyGXuB71qk1iJjA`, `pi_3UEcse2MwFyGXuB70uT9O8cS`). Cero desviación.

## 3. Barrido de variables

Base: Phoenix canariensis 4-10 ×2 = 180 €.

| Clave de `additional_config` | Delta esperado | Delta observado | Veredicto |
|---|---|---|---|
| `height_prices` (21 combinaciones especie×banda) | precio exacto por combinación | 21/21 exactos | PASA |
| `yield_units_per_hour` (21 combinaciones especie×banda) | horas exactas por combinación (×3 ud) | 21/21 exactos | PASA |
| `condition_surcharges.descuidado` | +36,00 € (20 %) | +36,00 € | PASA |
| `condition_surcharges.muy_descuidado` | +90,00 € (50 %) | +90,00 € | PASA |
| `condition_surcharges.normal` (cero explícito) | +0,00 € | +0,00 € | PASA — el 0 sembrado no lo pisa ningún default |
| `waste_removal.percentage` | +27,00 € (15 %) | +27,00 € | PASA |
| `phytosanitary` (€ plano ×2 ud) | +36,00 € | +36,00 € | PASA (precio) — pero +0 h, ver hallazgo #1b |
| `trunk_finish` (20 % de 90 ×2 ud) | +36,00 € | +36,00 € | PASA (precio) — pero +0 h, ver hallazgo #1a |
| `access_difficulty` (25 % de 90 ×2 ud) | +45,00 € | +45,00 € | PASA |
| `phytosanitary` en especie sin soporte (Syagrus) | +0,00 € | +0,00 € | PASA — guarda por especie correcta |
| `trunk_finish` en especie sin soporte (Trachycarpus) | +0,00 € | +0,00 € | PASA — guarda por especie correcta |
| `access_difficulty` en banda mínima (0-4) | +0,00 € | +0,00 € | PASA — guarda por banda mínima correcta |
| `minimum_price` | factura 60 € si el cálculo da menos | 60,00 € | PASA |

## 4. Matriz de paridad

| Variable | Config jardinero | Flujo IA (fotos) | Flujo manual | Motor | Veredicto |
|---|---|---|---|---|---|
| Especie + banda de altura | ✓ (`height_prices`/`yield_units_per_hour`, 6 especies) | ✓ (banda sin sufijo `m`) | ✓ (banda con sufijo `m`, verificado en pantalla en Ronda 2) | ✓ (`resolvePalmHeightKey` tolera ambos formatos) | OK — 108 €/1,5 h idéntico en ambos caminos (2A); wizard manual real confirma 180 €/2,5 h y 150 €/2 h (2C) |
| Banda terminal abierta (`>10`/`>10m`) | ✓ | ✓ | ✓ | ✓ (`isHighestOpenRangeForSpecies`, calculado por el servidor) | OK para el **precio** (150 € en ambos, aviso mostrado en pantalla) — **roto para el cambio de precio posterior** (hallazgo #4) |
| Estado (normal/descuidado/muy_descuidado) | ✓ | ✓ | ✓ | ✓ | OK |
| Retirada de restos | ✓ | ✓ (flag raíz `wasteRemoval`) | ✓ (misma flag, verificado en pantalla: "Retirada de restos: No" tras desactivar el switch) | ✓ | OK |
| Fitosanitario / pelado de tronco (extras) | ✓ | ✓ | ✓ (switches "Tratamiento de insecticida y fungicida" y "Limpieza / pelado de tronco", con **fitosanitario activado por defecto** — el wizard manual lo declara "esencial tras la poda") | ✓ en precio — ausente en horas | Sube el precio en los dos caminos por igual; ninguno suma horas (hallazgo #1) |
| Dificultad de acceso | ✓ | ✓ | ✓ | ✓ | OK |
| Cantidad de palmeras del grupo | ✓ (no aplica al jardinero) | **sin techo** (`handlePalmQuantityChange`) | **con techo** (`MANUAL_RANGES.palm.quantity.max=50`) | acepta cualquier valor no negativo | **Asimetría — hallazgo #2** |
| Cambio de precio (banda terminal) | — | (no probado, requiere flujo de fotos) | ✓ declarable | **✗ el RPC lo rechaza siempre** | **Roto — hallazgo #4** |

## 5. Guion de Fase 2

### Ronda 1 (2026-09-11) — motor puro y hallazgo del configurador

| Paso | Resultado | Evidencia |
|---|---|---|
| 2A.1-2A.7 (escenarios, paridad HTTP, barrido, límites, mínimo, cambio de precio del motor, disponibilidad) | PASA (65/65 numéricas) + 2 FALLA intencionadas (hallazgos #1/#2) | ver §2, §3, §6 |
| 2B Flujo IA con fotos reales | **NO PROBADO** | El repo no tiene fotos de muestra de palmeras. No se ha inventado ningún análisis. |
| 2C.a Configurador del jardinero | **PASA (confirma hallazgo #3)** | SQL antes/después + captura "✓ Guardado" no solicitado |

### Ronda 2 (2026-09-12) — resto de Fase 2C, tras resolverse el bloqueo del navegador

| Paso | Resultado | Evidencia |
|---|---|---|
| 2C.b Wizard manual completo como cliente (Phoenix canariensis 4-10, ×2, normal, sin extras) | **PASA** | Pantalla: "180,00 € al profesional · 2,5 h · 202,50 € total". Coincide exacto con la predicción S1. |
| 2C.b (bis) Wizard manual, banda terminal (Phoenix canariensis >10, ×1, normal) | **PASA** | Pantalla: "150,00 € al profesional · 2 h · 168,75 € total" + aviso `palm_terminal_range` mostrado literalmente al cliente. |
| 2C.c Listado de jardineros | **PASA** | Miguel Ángel Ruiz aparece con "5.0 (1)" y "Contratado anteriormente"; precio/horas correctos en la tarjeta. |
| 2C.d Reserva y pago con tarjeta de test (dos veces, una por escenario) | **PASA** | Pago 1: `pi_3UEche2MwFyGXuB71qk1iJjA`, `status: requires_capture → succeeded` tras aceptación, `amount_received: 2250`. Pago 2: `pi_3UEcse2MwFyGXuB70uT9O8cS`, autorizado por 1875 cts. `bookings` creado en ambos casos con `total_price`/`duration_hours`/`management_fee` coherentes con la pantalla. |
| Desglose cliente/jardinero | **PASA** | Pantalla y `pricing_context.quote_snapshot.economics`: `payableNow=22.50`, `payableLater=180`, `managementFee=22.50` — coincide con `garser-pricing-rules` (12,5 %). |
| Aceptación de la reserva por el jardinero | **PASA** | "Confirmar" en el panel → `bookings.status: pending → confirmed`; Stripe PaymentIntent `requires_capture → succeeded`, `amount_received=2250` (captura al aceptar, diseño deliberado ya documentado). |
| 2C.e Cambio de precio — **propuesta del jardinero** | **FALLA (documenta el hallazgo #4)** | Reserva de banda terminal (`>10m`, `isTerminalOpenRange: true` confirmado en `pricing_context`), jardinero propone 200 € desde "Solicitudes de Reserva" → `POST rpc/propose_booking_price_change` → `400 Bad Request`: `"No se permite proponer cambio de precio en palmeras fuera del último rango abierto de la especie."` (mensaje falso: sí está en el rango terminal). `bookings.price_change_status` se queda en `'none'`. |
| 2C.e Cambio de precio — **aceptación del cliente** | **NO PROBADO** | No se puede llegar a este paso: el paso anterior (la propuesta) nunca se completa por el hallazgo #4. |
| 2C.f Cancelación — pendiente, pago solo autorizado (sin capturar) | **PASA** | Cliente cancela reserva `78c269a8-…` en estado `pending`: `bookings.status → cancelled`; Stripe `pi_3UEcse2MwFyGXuB70uT9O8cS` → `status: canceled`, `amount_capturable: 0`, `amount_received: 0`. Nada cobrado. |
| 2C.f Cancelación — **confirmada y ya cobrada** (el caso que quedaba sin probar en `COORDINACION-SERVICIOS.md` §3.1-A) | **PASA — hallazgo positivo, resuelve una pregunta abierta transversal** | Cliente cancela reserva `fef54256-…`, ya `confirmed` y con el PaymentIntent `pi_3UEche2MwFyGXuB71qk1iJjA` en `succeeded`/`amount_received=2250`. Resultado: `bookings.status → cancelled` y **Stripe emite un reembolso real** `re_3UEche2MwFyGXuB71sXMGu88` por 2250 cts, `status: succeeded`. Ver §7. |
| 2C.g Finalización + reseña | **NO PROBADO** | `canMarkGardenerFinished()` exige `Date.now() >= start_time` de la reserva (`bookingLifecycleService.ts:161-170`) — diseño correcto (permite avisar antes de la hora de fin, no antes del inicio), pero implica que no se puede ejercitar sin una reserva cuya hora de inicio ya haya pasado de verdad. Las reservas creadas en esta sesión son para el 14, 18 y 21 de septiembre (hoy es el 12); no hay manera de simular el paso del tiempo desde la UI sin falsear la prueba. Para cerrarlo: repetir este paso cuando exista una reserva de palmeras cuyo inicio ya haya pasado, o crear una con fecha de hoy y una hora que ya haya transcurrido dentro de la cobertura del jardinero. |
| 2C.h Volver a reservar | **NO PROBADO** | Depende de tener una reserva de palmeras completada (ver 2C.g); no se ha forzado usando la de otro servicio (árboles) porque no es del alcance de esta auditoría. |
| 2C.i Subida de fotos por UI | **NO PROBADO** (fuera de alcance del agente, según la skill) | el panel Browser no tiene herramienta de subida de ficheros |

**Nota sobre el bloqueo de la Ronda 1.** A mitad de la Fase 2C, el clasificador de modo
automático del navegador rechazó durante un tramo cualquier acción de escritura en la
página (temporalmente, sin razón visible), lo que impidió avanzar más allá del hallazgo
#3 en la primera sesión. En la Ronda 2 el clasificador ya no bloqueaba nada y se pudo
completar el resto de 2C con normalidad.

## 6. Red de regresión

Runner: `scripts/readiness/palmeras.mjs` (reescrito por completo en esta auditoría; el
`serviceId` fantasma y las dos predicciones de horas que asumían fixes inexistentes ya
están corregidos).

```bash
export SUPABASE_PROJECT_DIR=~/Downloads/GarSer-referencia
export SUPABASE_DB_CONTAINER=supabase_db_GarSer-referencia
READINESS_ENGINE=local node scripts/readiness/palmeras.mjs
```

Resultado actual: **65 PASA · 3 FALLA · 0 NO PROBADO**. Las 3 fallas son intencionadas —
documentan los hallazgos #1a, #1b y #2. El hallazgo #4 (cambio de precio) no lo cubre este
runner porque `propose_booking_price_change` es una RPC de base de datos que actúa sobre
una reserva ya persistida (con su `pricing_context` completo) — no es una comprobación de
`recalculate_correction`. Queda pendiente añadir un caso a este runner o a un runner de
ciclo de vida que invoque la RPC directamente contra una reserva de prueba con
`pricing_context` de banda terminal, para que la regresión de este hallazgo quede cubierta
automáticamente.

## 7. Hallazgos transversales

- **Extensión de T1** (`COORDINACION-SERVICIOS.md` §3.2): el vacío de licencia
  fitosanitaria (T1) alcanza también al extra `hasPhytosanitary` de **palmeras**
  (`ProvidersPage.tsx:405-411` nunca calcula `requiresChemical` para `'Poda de
  palmeras'`, y aunque lo hiciera T1 ya dice que el flag es cosmético). Añadido a §3.2.
- **Segunda confirmación del patrón de autoguardado en el primer render**: palmeras
  confirma el mismo mecanismo que setos (`useAutoSave` + objeto derivado no `deepEqual`
  al de BD), con un disparador distinto (migración de `selected_species`). 2 de 7
  configuradores confirmados (setos, palmeras); 5 sin revisar. Añadido a §3.2.
- **Resuelve una pregunta abierta de `COORDINACION-SERVICIOS.md` §3.1-A**: "no se ha
  probado cancelar después de que el jardinero acepte o después de que el pago se
  capture […] no se ha verificado que exista ese camino". **Sí existe, y funciona**:
  cancelar una reserva de palmeras `confirmed` con el pago ya `succeeded` dispara un
  reembolso real de Stripe (`re_3UEche2MwFyGXuB71sXMGu88`, 22,50 €, `status: succeeded`).
  Es un mecanismo compartido (no específico de palmeras), así que la confirmación se ha
  añadido a §3.1 para que las demás auditorías no repitan la pregunta.
- **Reproducciones de hallazgos ya documentados** (sin acción, solo constancia de que
  también ocurren en palmeras): T10 (el texto "Horario del trabajo" concatena
  `11 + 2.5` como `"13.5:00"` en vez de `"13:30"`, reproducido en el paso de selección de
  hora); T6 (la cabecera de "Solicitudes de Reserva" muestra siempre `(1h)` aunque la
  duración real declarada más abajo sea `2h`/`3h`); T9 ("Cliente desconocido" en
  "Solicitudes de Reserva" pese a que el nombre real se resuelve bien en "Mis Reservas").

Todo esto se ha añadido a `docs/audit/COORDINACION-SERVICIOS.md` §3.1/§3.2. No se ha
tocado ningún fichero compartido ni de otro servicio.

## 8. Acciones manuales del usuario

- **Decidir el turno de corrección de palmeras** (Fase 3): esta sesión se detiene aquí
  por mandato explícito. Los 4 hallazgos (§1) están descritos con fix propuesto pero sin
  aplicar. El hallazgo #4 (cambio de precio roto) es, con evidencia end-to-end, el más
  urgente de los cuatro: es una funcionalidad completamente inoperante, no un cálculo
  parcialmente incompleto.
- **2B (flujo IA) sigue sin probar de extremo a extremo.** Hacen falta 2-3 fotos reales
  de palmeras para subirlas al bucket `booking-photos` local y ejercitar
  `ai-pricing-estimator` de verdad.
- **2C.g/2C.h (finalización, reseña, volver a reservar) sin probar**, no por ningún
  bloqueo del entorno sino porque requieren una reserva cuya hora de inicio ya haya
  pasado de verdad (`canMarkGardenerFinished` está correctamente atado al reloj real).
  Repetir cuando exista una reserva de palmeras vencida, o crear una para "hoy" a una
  hora que ya haya transcurrido.
- **2C.i (subida de fotos por `<input type=file>`)**: fuera del alcance del agente por
  diseño de la skill.
- Reservas de prueba creadas y cerradas en esta auditoría (no requieren ninguna acción,
  quedan como historial normal del jardinero/cliente de prueba): `fef54256-…` (cancelada
  tras confirmarse y cobrarse, con reembolso), `78c269a8-…` (cancelada mientras estaba
  pendiente, sin cobro).
- El dev server de este worktree quedó corriendo en segundo plano en el puerto 5184
  (`nohup npm run dev -- --port 5184 --strictPort`, log en `/tmp/palmeras-vite.log`).
  Puede matarse con seguridad cuando ya no se necesite
  (`lsof -nP -iTCP:5184 -sTCP:LISTEN` para localizar el PID).
- **(Actualizado en Fase 3, ver §9): sí hay una migración y una función que desplegar** —
  `supabase db push` y redespliegue de `booking-authority` — antes de que el fix del
  hallazgo #4 llegue a producción. Detalle completo en §9.

---

## 9. Cierre de Fase 3 (2026-09-12)

Autorizada por el usuario tras presentar el informe de arriba. Los 4 hallazgos se han
corregido, cada uno contenido en su propio fichero (o en el bloque de palmeras dentro de
un fichero compartido), sin tocar código de otro servicio.

### Qué se corrigió

| # | Fichero | Cambio |
|---|---|---|
| 4 | `supabase/migrations/20260912100000_fix_palm_price_change_pricing_context_path.sql` (nuevo) | `CREATE OR REPLACE FUNCTION propose_booking_price_change`, corrigiendo solo la lectura dentro de `IF v_is_palm_service THEN`: de `pricing_context->'palm_groups'` / `is_terminal_open_range` a `pricing_context #> '{quote_snapshot,metadata,pricingContext,palmGroups}'` / `isTerminalOpenRange`. El resto de la función queda idéntico a `20260803121000_fix_price_change_security_definer.sql`. |
| 1a/1b | `src/domain/pricingEngine.ts` | `calculatePalmHoursFromConfig`: añadido `trunkMult` (mismo % que `trunk_finish` aplica al precio, cuando `hasTrunkPeeling` y la especie lo admite) y una constante nueva `PALM_PHYTOSANITARY_TIME_HOURS = 0.1` que se suma × `quantity` cuando `hasPhytosanitary` y la especie lo admite. |
| 2 | `src/shared/bookingQuoteCore.ts` (bloque `if (palmGroups.length)`) | Nueva constante `PALM_MAX_PLAUSIBLE_QUANTITY = 20` y `pushWarning('palm_quantity_implausible', …)` por grupo que la supere. |
| 2 | `src/pages/reserva/DetailsPage.tsx` (`handlePalmQuantityChange`) | El clamp pasa de `Math.max(1, …)` a `Math.min(MANUAL_RANGES.palm.quantity.max, Math.max(MANUAL_RANGES.palm.quantity.min, …))`, con el mismo aviso "Máximo N…" que ya tenía árboles. |
| 3 | `src/components/gardener/PalmPricingConfigurator.tsx` | La migración de `selected_species` (cuando el campo no existe en la config entrante) ahora también marca como "activada" cualquier especie con al menos una banda con precio > 0 en `height_prices`, no solo en `species_prices` (que en el jardinero sembrado están todos a 0). |

### Verificación

- **Runner (motor puro):** `READINESS_ENGINE=local node scripts/readiness/palmeras.mjs` →
  **71 PASA · 0 FALLA · 0 NO PROBADO** (antes: 65 PASA · 3 FALLA). El propio runner se
  actualizó para predecir el comportamiento CORREGIDO (trunk/fito sí mueven horas,
  quantity>20 sí dispara aviso) en vez de documentar el bug.
- **Hallazgo #4, verificación end-to-end real** (no la cubre el runner, que solo habla con
  `recalculate_correction`): tras aplicar la migración al Postgres local,
  1. Consulta SQL directa confirmando que la ruta corregida distingue correctamente una
     reserva en banda terminal de una que no lo está:
     ```
     78c269a8-... (Phoenix canariensis >10m) → has_terminal_open_range_FIXED = t
     fef54256-... (Phoenix canariensis 4-10)  → has_terminal_open_range_FIXED = f
     ```
  2. Llamada RPC real autenticada como el jardinero contra `78c269a8-...`:
     ```json
     {"status": "pending_client_acceptance", "booking_id": "78c269a8-...", "expires_at": "2026-09-12T22:48:52...", "proposed_total_price": 200}
     ```
     Antes de este fix, la misma llamada devolvía `400` con el mensaje falso "No se
     permite proponer cambio de precio en palmeras fuera del último rango abierto de la
     especie." Estado de la reserva de prueba revertido a `price_change_status='none'`
     tras la verificación (no queda ninguna propuesta de precio a medias).
- **Hallazgo #3, verificación en vivo:** con el dev server sirviendo el código corregido
  (HMR), se reabrió el panel "Configurar Poda de palmeras" del jardinero sembrado. Antes
  mostraba "No hay especies de palmeras seleccionadas."; ahora muestra las 6 especies
  activas con sus bandas y precios reales. SQL de confirmación:
  ```
  selected_species = ["Phoenix canariensis","Phoenix dactylifera","Washingtonia robusta/filifera","Syagrus romanzoffiana","Trachycarpus fortunei","Roystonea regia"]
  height_prices->'Phoenix canariensis' = {"0-4": 45, ">10": 150, "4-10": 90}  ← intacto
  ```
- **Tipos:** `npx tsc --noEmit -p tsconfig.app.json` → 172 errores, igual que antes de
  tocar nada (no sube).
- **Tests:** `npx vitest run` → **434/434**. Se actualizó una aserción preexistente en
  `src/shared/bookingQuoteCore.test.ts` ("palmeras per_quantity: fórmula completa §7.4 con
  estado, restos, extras y acceso"): ese escenario activa `hasTrunkPeeling` y
  `hasPhytosanitary` a la vez, así que con el fix las horas correctas suben de 4 a 5 (el
  precio, ya correcto antes, no cambia: sigue en 472 €). No es un test debilitado: la
  aserción vieja describía el bug, la nueva describe el cálculo correcto, con el desglose
  numérico completo en el comentario.

### Hallazgos transversales durante la corrección

Ninguno nuevo. Las dos notas ya registradas en la Fase 2 (extensión de T1 a la licencia
fitosanitaria de palmeras, y la segunda confirmación del patrón de autoguardado en el
primer render) siguen siendo las únicas: ningún fix de esta Fase 3 tocó código de otro
servicio ni reveló un problema compartido nuevo.

### Ficheros modificados en esta rama

```
docs/audit/2026-09-11-palmeras/REPORT.md                                        (nuevo)
docs/audit/COORDINACION-SERVICIOS.md                                            (notas)
scripts/readiness/palmeras.mjs                                                  (reescrito + actualizado tras el fix)
src/components/gardener/PalmPricingConfigurator.tsx                             (hallazgo #3)
src/domain/pricingEngine.ts                                                     (hallazgo #1a/#1b)
src/pages/reserva/DetailsPage.tsx                                               (hallazgo #2, UI)
src/shared/bookingQuoteCore.test.ts                                             (test actualizado)
src/shared/bookingQuoteCore.ts                                                  (hallazgo #2, motor)
supabase/migrations/20260912100000_fix_palm_price_change_pricing_context_path.sql (nuevo, hallazgo #4)
```

### Acciones manuales del usuario — actualizado tras la Fase 3

1. **Revisar y mergear la PR** (el enlace se entrega tras crearla).
2. **Tras el merge, desplegar en este orden:**
   ```bash
   supabase db push
   ```
   ```bash
   supabase functions deploy booking-authority --use-api
   ```
   `booking-authority` no importa la función SQL directamente (es una RPC de Postgres,
   no código de la función), así que el `db push` ya la deja activa — el redespliegue de
   `booking-authority` es por los cambios de `bookingQuoteCore.ts`/`pricingEngine.ts`
   (hallazgos #1a/#1b/#2), que sí importa esa función.
   Y por último el front (Vercel).
3. **Poner al día el entorno local compartido** (lo hace el usuario, corta a las demás
   sesiones unos segundos):
   ```bash
   cd ~/Downloads/GarSer-referencia && git pull && supabase stop && supabase start
   cd ~/Downloads/GarSer-referencia && supabase migration up
   ```
   Y avisar a las sesiones activas de que repitan las pruebas que toquen `bookingQuoteCore.ts`,
   `pricingEngine.ts`, `DetailsPage.tsx` o `propose_booking_price_change`.
4. **Ejecutar todos los runners por HTTP** (no solo el de palmeras) tras el despliegue:
   ```bash
   for r in scripts/readiness/*.mjs; do node "$r" || echo "FALLA $r"; done
   ```
5. **2B (flujo IA) sigue sin probar de extremo a extremo** — hacen falta fotos reales de
   palmeras. **2C.g/h (finalización, reseña, volver a reservar) siguen sin probar** — el
   botón de finalizar está atado al reloj real (`canMarkGardenerFinished`), no a ningún
   bloqueo; repetir cuando exista una reserva de palmeras cuyo inicio ya haya pasado.
6. Reservas de prueba de esta sesión, ya cerradas y sin acción pendiente: `fef54256-…`
   (cancelada tras confirmarse y cobrarse, con reembolso emitido), `78c269a8-…` (cancelada
   mientras estaba pendiente, sin cobro; su intento de cambio de precio de la verificación
   quedó revertido a `none`).
7. El dev server de este worktree sigue corriendo en el puerto 5184
   (`lsof -nP -iTCP:5184 -sTCP:LISTEN` para localizarlo y matarlo cuando no haga falta).
