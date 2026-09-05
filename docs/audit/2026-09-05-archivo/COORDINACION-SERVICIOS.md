# Coordinación entre las auditorías de servicio

> Seis chats auditando seis servicios a la vez, cada uno en su rama. Este fichero existe
> por una razón concreta: **el motor de precios de los siete servicios vive en un solo
> fichero**, así que aunque cada chat toque solo su servicio, todos editan las mismas
> líneas. Aquí se anota quién toca qué y qué está pendiente de decidir en común.
>
> Se actualiza al terminar cada servicio. Dos secciones, y nada más: el registro de
> ficheros compartidos y la lista de hallazgos que afectan a más de un servicio.

---

## 0. ALTO — leer antes de tocar nada (2026-09-05, tarde)

Han aparecido dos cosas que invalidan parte del plan anterior. Nadie despliega ni integra
hasta que estén resueltas.

### 0.1 · Producción puede estar cobrando sin crear reservas

La sesión de desbroce desplegó `booking-payment` a producción desde una rama basada en el
checkout local. Esa versión **no tiene `capture_method`**, así que hereda el default de la
cuenta de Stripe —que está en captura manual— y deja los pagos en `requires_capture` sin
nadie que los capture: **dinero retenido al cliente y reserva sin crear**.

`origin/main` sí lo resuelve, y de forma deliberada: `capture_method: 'manual'` con captura
explícita cuando la reserva se confirma (PR #9, "captura diferida"). Lo desplegado ahora
mismo no coincide con ninguna rama conocida.

**Acción, antes que cualquier otra cosa:** redesplegar `booking-payment` y
`booking-authority` **desde `origin/main` tal cual**, sin fixes de ninguna rama de
auditoría, para devolver producción a un estado conocido. Solo después se planifica qué
añadir encima.

### 0.2 · Las seis auditorías se han hecho sobre una base que no es la de producción

Los seis worktrees salieron de `98b54ae`. Ese commit **no está en `origin/main`**: es la
punta de una línea local de 8 commits (emails, chat, wizard, tarjetas de jardinero,
disponibilidad, endurecimiento) que nunca se subió a GitHub. La base común real de las dos
líneas es `a8de8cf`.

Mientras tanto, `origin/main` avanzó por su cuenta con las PR #8–#16, que hacen **el mismo
trabajo en paralelo**. Producción va con `origin/main`.

Consecuencia: **una parte de lo auditado y corregido no aplica a producción, y otra parte
arregla algo que main ya resolvió de otra manera.** Hay que revisar hallazgo por hallazgo
contra `origin/main` antes de integrar nada.

### 0.3 · Inventario: qué de §3.1 sobrevive al contraste con `origin/main`

Comprobado el 2026-09-05 contra `origin/main` (`50a6031`):

| Hallazgo de §3.1 | Situación real en `origin/main` | Qué hacer |
|---|---|---|
| 1 · Catálogo público de jardineros | **Ya resuelto**: existe `public_gardener_directory` y `ProvidersPage` la usa | **Descartar** la vista `gardener_public_catalog`. Es un duplicado |
| 2 · `capture_method` del pago | **Ya resuelto y mejor**: captura diferida deliberada (PR #9) | **Descartar el fix, y no volver a proponerlo.** Poner `automatic` cobraría antes de que el profesional acepte, que es justo lo que la captura diferida evita |
| 3 · Puerta de licencia fitosanitaria | **No existe** (0 referencias) | **Sirve.** Rehacer sobre `origin/main` |
| 4 · Catch mudo de `booking-complete` | El fichero cambió en main; hay que releerlo | Revisar sobre `origin/main` |
| 5 · «Servicio Completado» antes de empezar | **No existe la guarda** | **Sirve.** Rehacer sobre `origin/main` |
| Redondeo de horas (hallado por césped, arbustos y desbroce) | **Sigue presente**: `totalHours *= 0.9` en main | **Sirve.** Basta con uno de los dos commits gemelos (`6a43401` o `a2395c3`) |

Y una buena noticia: el bloque del motor de **fitosanitarios es idéntico byte a byte**
entre `98b54ae` y `origin/main`, así que ese trabajo se aplica a main sin cambios. Cada
chat debería hacer la misma comprobación con su propio bloque antes de dar nada por bueno:

```bash
git diff 98b54ae origin/main -- src/shared/bookingQuoteCore.ts
```

### 0.4 · La rama `claude/plataforma-transversal` está mal fundada

Salió de `98b54ae`, no de `origin/main`, y dos de sus cinco arreglos son duplicados o
contraproducentes (§0.3). **No se integra tal cual.** Hay que rehacerla desde `origin/main`
con lo que sobreviva del inventario.

---

## 1. Las dos reglas

**Regla 1 — No se toca el servicio de otro.** Ni su configurador, ni su bloque del motor,
ni su encuesta manual, ni su runner.

**Regla 2 — Un hallazgo que afecta a más de un servicio se documenta aquí, no se arregla
en la rama del servicio.** Va a §3 y se decide aparte. Arreglarlo en la rama de un servicio
es lo que produce conflictos en el motor de precios, que es el único sitio donde un
conflicto mal resuelto cuesta dinero.

La segunda regla es la que de verdad evita los choques. La primera solo evita el desorden.

---

## 2. Registro de ficheros compartidos

Qué rama toca qué fichero del tronco común. Si dos ramas aparecen en la misma fila, hay que
mirar esa fila antes de integrar nada.

| Fichero compartido | Ramas que lo tocan | Riesgo |
|---|---|---|
| `src/shared/bookingQuoteCore.ts` | césped+setos · fitosanitarios · 71595e · 308203 (árboles) · b14a9c (arbustos) · **65ee05 (desbroce)** | **Alto.** El motor de precios. Un conflicto mal resuelto aquí cobra mal |
| `src/pages/reserva/ProvidersPage.tsx` | césped+setos · fitosanitarios · 71595e | **Alto.** Resuelto en `claude/plataforma-transversal` |
| `scripts/readiness/_harness.mjs` | césped+setos · fitosanitarios · 71595e · b14a9c (arbustos) · **65ee05 (desbroce)** | Medio. Cada rama lo copió de la skill y lo modificó. Ahora vive en la rama transversal |
| `src/shared/manualEntry/manualEntrySchema.ts` | césped+setos · fitosanitarios · 71595e · **b14a9c (arbustos)** | Medio. Cada servicio tiene su bloque; git suele mezclarlo solo |
| `supabase/functions/booking-authority/index.ts` | césped+setos · fitosanitarios · 71595e | Medio. **65ee05 (desbroce) lo tocó y ya lo revirtió — ver nota de producción más abajo, es la fila que de verdad importa hoy** |
| `src/pages/reserva/manualEntryBuilders.ts` | césped+setos · fitosanitarios | Bajo |
| `src/pages/reserva/DetailsPage.tsx` | 308203 (árboles) · **65ee05 (desbroce)** | Bajo. árboles solo eliminó dos líneas de import comentadas. **65ee05 añade un `useEffect` propio de desbroce** (marca `dataInputMode:'manual'` cuando `isWeedingServiceSelected`, condicionado a ese flag — no debería tocar ningún otro servicio, pero es el fichero más grande y compartido de los 7: revisa esta fila si tu rama también lo toca) |
| `src/types/index.ts` | césped+setos · 71595e · **b14a9c (arbustos)** | Bajo |
| `src/utils/aiPricingEstimator.ts` | césped+setos · 71595e | Bajo |
| `src/utils/serviceValidation.ts` | b14a9c (arbustos) · **65ee05 (desbroce)** | Bajo. arbustos toca `isShrubConfigValid`; **65ee05 toca `weedingV1Schema.precio_desbroce_m2` (nonnegative → positive, alineado con lo que ya exige el motor)** — funciones distintas, sin solape |
| `supabase/functions/_shared/imageSourceGuard.ts` | césped+setos · 71595e | Bajo |
| `supabase/functions/_shared/functionAuth.ts` | césped+setos · 71595e | Bajo |
| `supabase/functions/booking-payment/index.ts` | fitosanitarios · 71595e | **Alto.** Toca dinero. **65ee05 (desbroce) lo tocó y ya lo revirtió en su rama — ver nota de producción más abajo** |
| `supabase/functions/booking-payment-webhook/index.ts` | 71595e | — |

**Conflictos reales medidos** (merge en seco entre césped+setos y fitosanitarios, 2026-09-05):
`bookingQuoteCore.ts`, `ProvidersPage.tsx` y `_harness.mjs`. Los demás git los mezcla solo.

### Ficheros compartidos que toca árboles, y por qué

| Fichero | Qué le hace | ¿Pisa a otro servicio? |
|---|---|---|
| `src/shared/bookingQuoteCore.ts` | Añade `hasCompleteTreeYields` y un guard antes de calcular `treeQuote`: si al jardinero le falta `yield_units_per_hour`, devuelve `missing_yield_config` en vez de que `getBandYield` reviente con un TypeError (500) sobre `undefined.estructural`. Confirmado con test unitario (27/27) y con `READINESS_ENGINE=local` contra el motor real de esta rama (antes crasheaba, ahora 422 `missing_yield_config`) | No. Solo toca `isTreePruningConfig`/`hasCompleteTreeYields`/el bloque `treeGroups`, que ningún otro servicio usa |
| `scripts/readiness/_harness.mjs` | Lo copié de la skill (versión antigua, sin `READINESS_ENGINE=local`) y le añadí un fallback propio para resolver `supabase status` desde un git worktree. Al ver que esta rama transversal ya tiene una solución mejor (`SUPABASE_PROJECT_DIR` + motor local con esbuild), **descarté mi parche y adopté esta versión tal cual** — ningún cambio mío sobrevive en este fichero | No |
| `src/pages/reserva/DetailsPage.tsx` | Borra 2 líneas de import comentadas que apuntaban a `TreePruningBooking`/`domain/treePruning`, ambos ya eliminados (código muerto de árboles) | No, son solo comentarios |

**Dato para el registro, más allá de árboles:** el checkout desde el que está levantado el
stack local (`fix/pagos-emails-geocoding`) tiene su propio `bookingQuoteCore.ts`, divergido
del de esta rama (y probablemente del de las demás) — mismo fichero, historial de commits
distinto. Diferencias que vi al diffear: el checkout importa `findPalmYield` y
`BOOKING_MANAGEMENT_FEE_RATE` desde `bookingAmounts.ts`; esta rama define
`getBookingCustomerPaymentSummary` y una constante local. El bloque de árboles resultó ser
byte a byte idéntico en ambos (por eso mis pruebas HTTP de antes de este aviso eran válidas
sin saberlo), pero fue suerte, no garantía: cualquier otra rama que dependa de medir por HTTP
debería diffear su propio bloque contra el checkout antes de confiar en el resultado, o usar
`READINESS_ENGINE=local` como cierre real. Añadido como nota a §3.2-C.

### Ficheros compartidos que toca fitosanitarios, y por qué

| Fichero | Qué le hace | ¿Pisa a otro servicio? |
|---|---|---|
| `src/shared/bookingQuoteCore.ts` | Reescribe `calculatePhytosanitaryQuote` y el bloque de horas fitosanitario | No, salvo dos cambios de alcance general: el mínimo se aplica una sola vez (`minimumAlreadyResolved`) y el desglose se redondea una vez en lugar de línea a línea |
| `src/shared/manualEntry/manualEntrySchema.ts` | Reescribe la encuesta `phytosanitary` y añade `offersWasteRemoval` al tipo | El campo nuevo es opcional: los otros seis servicios se comportan igual |
| `src/components/booking/manual/ManualEntryWizard.tsx` y `ManualEntrySummary.tsx` | Saltan la fase de retirada de restos si el servicio no la ofrece | Solo fitosanitarios la apaga hoy |
| `src/pages/reserva/manualEntryBuilders.ts` | Reescribe `buildPhytosanitaryZones` | No |
| `src/shared/manualEntry/manualEntryValidation.ts` | Valida la banda de tamaño fitosanitaria | No |
| `src/components/booking/manual/fields/ManualFieldRenderer.tsx` | Registra el icono `Syringe` | No |

### Ficheros compartidos que toca arbustos (b14a9c), y por qué

Dos commits separados a propósito: `554914f` (arbustos, se queda en esta rama) y `6a43401`
(motor, transversal — ver §3.2).

| Fichero | Qué le hace | ¿Pisa a otro servicio? |
|---|---|---|
| `src/shared/bookingQuoteCore.ts` (554914f) | Reescribe `buildShrubBreakdown`: antes redondeaba cada línea por separado y podía sumar más que el total autoritativo (mismo patrón de bug que fitosanitarios ya corrigió en su propia función, ver fila de arriba) | No, solo toca `buildShrubBreakdown`, función que ningún otro servicio llama |
| `src/shared/bookingQuoteCore.ts` (6a43401) | Redondea `totalHours` a 1e-6 antes del techo a fracción de hora, para absorber un residuo de coma flotante (`*0.9` del descuento de eficiencia) que empujaba media hora de más | **Sí, a los 7** — por eso va en commit aparte, ver §3.2 |
| `src/types/index.ts` | Añade `condition_surcharges: { media, alta }` a `ShrubPricingConfig` | No, interfaz propia de arbustos |
| `src/utils/serviceValidation.ts` | `isShrubConfigValid` exige `condition_surcharges` (puede ser 0, pero debe existir) | No, función propia de arbustos |
| `src/shared/manualEntry/manualEntrySchema.ts` | `MANUAL_RANGES.shrub.superficie_m2.max`: 2000 → 500, alineado con el techo de plausibilidad del prompt de IA (mismo patrón que `hedge`) | No, solo la clave `shrub` |
| `scripts/readiness/_harness.mjs` | Lo copié de la skill (versión sin `READINESS_ENGINE=local`) y le añadí un fallback para resolver `supabase status` desde un git worktree (`resolveSupabaseCwd`, vía `git rev-parse --git-common-dir`) | No. Mismo caso que árboles: en cuanto tenga acceso a la versión de `claude/plataforma-transversal`, descarto mi parche y adopto esa |
| `docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md` | El fichero no existía en mi worktree — lo creé con la sección de arbustos | Riesgo de colisión "añadir/añadir" si otra rama también lo creó de cero con su propia sección: revisar al fusionar, debería bastar con concatenar secciones |

**Nota sobre medir por HTTP en este entorno:** audité arbustos usando el stack local
compartido (`supabase_db_GarSer-main_4`), que sirve el código de otro checkout, no el de
mi worktree — no lo supe hasta este aviso de coordinación. Mis escenarios de la Fase 2
(antes del fix) se verificaron por HTTP contra ESE checkout, no contra `b14a9c`; la
Fase 3 (los 4 fixes) la verifiqué en cambio con tests unitarios (`npx vitest run`, que sí
importan el código de mi worktree directamente) — 62/62 ficheros en verde, incluidos 3
tests nuevos que reproducen los 4 bugs. Pendiente: reejecutar `scripts/readiness/arbustos.mjs`
por HTTP contra un stack levantado desde mi propio directorio antes de dar el veredicto
final por bueno.

### Ficheros compartidos que toca desbroce (65ee05), y por qué

Dos commits separados a propósito: `993e3cb` (desbroce, se queda en esta rama) y `a2395c3`
(motor, transversal — ver §3.2-D, es el mismo bug que ya aisló arbustos en `6a43401`).

| Fichero | Qué le hace | ¿Pisa a otro servicio? |
|---|---|---|
| `src/pages/reserva/DetailsPage.tsx` (993e3cb) | Añade un `useEffect` que marca `bookingData.dataInputMode = 'manual'` cuando `isWeedingServiceSelected` es true. Desbroce es manual-only (sin fotos) y su formulario dedicado nunca marcaba este flag, así que la validación de rango de superficie de `booking-authority` (`MANUAL_RANGES.weeding.area`, 1-10.000 m²) nunca se ejecutaba para este servicio — probado: 50.000 m² se aceptaba sin más, 17.500 €/375 h | No, el efecto está condicionado a `isWeedingServiceSelected` |
| `src/utils/serviceValidation.ts` (993e3cb) | `weedingV1Schema.precio_desbroce_m2`: `nonnegative()` → `positive()`, alineado con lo que el motor ya exige (`hasPositiveNumber`) para no dejar "activar" un servicio con precio 0 que el motor excluye en silencio | No, bloque propio de `weedingV1Schema` |
| `src/shared/bookingQuoteCore.ts` (a2395c3) | Mismo fix que arbustos `6a43401`: redondea `totalHours` a 1e-6 antes del techo a fracción de hora. Lo encontré de forma independiente auditando desbroce (1000m² sin retirada, yield 120 m²/h, normal: 8h obtenidas en vez de 7,5h) — **tercera confirmación del mismo bug** (césped, arbustos, desbroce), refuerza que es real y transversal | **Sí, a los 7** — por eso va en commit aparte. No hace falta cherry-pickear el mío: es funcionalmente idéntico a `6a43401`, que ya está señalado como el candidato a llevar a `plataforma-transversal` |
| `src/shared/bookingEligibilityCore.ts`, `supabase/functions/booking-authority/index.ts`, `supabase/functions/booking-payment/index.ts` | Escribí una puerta de licencia propia (`requiresCertifiedLicense`, columna `has_phytosanitary_license`, código `missing_certified_license`) sin saber que ya existía la de `claude/plataforma-transversal` (`requiresPhytosanitaryLicense` + RPC `gardener_has_phytosanitary_license`, código `missing_phytosanitary_license`, fila 3 de §3.1). **Ya revertido de mi rama** (los 3 ficheros vuelven a ser idénticos a `plataforma-transversal`) | Sí — por eso está revertido, no hace falta decidir nada aquí |

**⚠️ Aviso para quien gestione el despliegue a producción — esto no es una nota de rama, es
el estado real de `booking-authority` y `booking-payment` en el proyecto remoto
`hleqspdnjfswrmozjkai` ("M&J GreenServices") ahora mismo:**

Antes de leer este fichero de coordinación por primera vez, desplegué esos dos edge
functions a producción desde esta rama (`supabase functions deploy --use-api`,
autorizado explícitamente por el usuario en el momento, sin saber todavía que existía este
proceso de coordinación). Ese despliegue **sí incluye** el fix de redondeo de horas (mismo
que `6a43401`) pero **también incluye** mi puerta de licencia duplicada de la tabla de
arriba — la oficial (RPC) **no** está desplegada, la mía (columna simple) **sí** lo está, y
ninguna de las dos versiones vive ya en ninguna rama tal cual está en producción (la mía
porque la revertí localmente sin volver a desplegar; la oficial porque nunca llegó a este
despliegue). Tampoco están desplegados los otros 4 puntos de §3.1 (RLS de
`gardener_profiles`, `capture_method` de Stripe, catch de `booking-complete`, botón
"Servicio Completado") si no lo estaban ya por otra vía — no tengo forma de comprobar el
historial de despliegues desde aquí. El usuario ha decidido explícitamente no tocar más
producción desde mi rama y dejar que `claude/plataforma-transversal` lo coordine cuando
toque (regla de §4): quien haga ese despliegue debe asumir que el estado actual de
`booking-authority`/`booking-payment` en remoto **no es un baseline limpio de ninguna
rama**, y redesplegar el conjunto completo de `plataforma-transversal` en cuanto se integre,
en vez de asumir que solo hace falta añadir los cambios de encima.

---

## 3. Hallazgos que afectan a varios servicios

### 3.1 · Ya corregidos, en `claude/plataforma-transversal`

Salieron auditando fitosanitarios y se sacaron a su propia rama. **Esta rama se integra
antes que cualquier rama de servicio.**

| # | Qué pasaba | Alcance |
|---|---|---|
| 1 | **Un cliente nuevo no veía a ningún profesional.** `ProvidersPage` leía `gardener_profiles`, cuya RLS solo deja leer a quien ya comparte una reserva. Un usuario recién registrado veía la lista vacía | Los 7 servicios |
| 2 | **El adelanto se cobraba y la reserva no se creaba.** El PaymentIntent heredaba `capture_method` de la cuenta de Stripe (en manual) y quedaba autorizado sin cobrar; el sync no contemplaba ese estado | Toda la app |
| 3 | **La licencia fitosanitaria no filtraba a nadie.** Se leía y no excluía a nadie. Ahora la puerta está en `booking-authority` | Fitosanitarios y desbroce con herbicida |
| 4 | El catch de `booking-complete` descartaba el motivo real de cualquier error | Toda la app |
| 5 | El panel ofrecía «Servicio Completado» en reservas que aún no habían empezado | Toda la app |

### 3.2 · Pendientes de decisión — nadie los arregla todavía

| # | Qué pasa | Por qué está parado |
|---|---|---|
| A | **No existe ningún reembolso, en ninguna parte.** El cliente paga la tarifa, el profesional rechaza, la reserva queda cancelada y el dinero no vuelve. Verificado: `reembolsos: 0` en Stripe, cargo `succeeded`. Buscar `refund` en el repo no devuelve una línea | Hace falta decidir la política: quién asume la tarifa según quién cancele y con cuánta antelación, si hay penalización, y qué pasa con el importe pendiente al profesional |
| B | **El cliente no puede cancelar su reserva.** En «Mis Reservas» solo hay «Chat» | Depende de A: sin política de reembolso, un botón de cancelar deja el dinero en el aire igual |
| C | Seis edge functions divergen entre `main` y `fix/pagos-emails-geocoding`: `ai-pricing-estimator`, `booking-complete`, `booking-confirmation-email`, `booking-payment-webhook`, `booking-telemetry`, `send-email-notification`. **Añadido (308203, árboles):** `src/shared/bookingQuoteCore.ts` también diverge entre `fix/pagos-emails-geocoding` (el checkout desde el que corre el stack local) y esta rama de servicio — mismo fichero, dos historiales. El bloque de árboles resultó idéntico en ambos por casualidad, no por garantía; cualquier rama que mida por HTTP debería diffear su propio bloque contra ese checkout antes de dar un PASA por bueno, o usar `READINESS_ENGINE=local` (ver §2) | Hay que decidir qué versión manda antes de integrar nada que las toque. Para `bookingQuoteCore.ts` en concreto, esto se resuelve solo al fusionar `claude/plataforma-transversal` en `main` primero (regla de §4) |
| D | **Redondeo de horas: residuo de coma flotante empuja media hora de más.** `totalHours *= 0.9` (descuento de eficiencia >8h) puede dejar p.ej. `15.000000000000002` en vez de `15`, y `Math.ceil(totalHours*2)/2` lo sube a la siguiente franja de media hora. Afecta al acumulador de horas común, no a un bloque de servicio — reproducido con césped (200 m², rendimiento 12 m²/h: 15h esperadas, 15,5h obtenidas) al auditar arbustos, y **de forma independiente otra vez auditando desbroce** (1000 m² sin retirada, yield 120 m²/h, normal: 7,5h esperadas, 8h obtenidas) | **No está parado, a diferencia de A/B/C: ya está corregido y aislado — dos veces, de forma independiente.** Commit `6a43401` en `claude/garser-service-production-readiness-b14a9c` (arbustos) y commit `a2395c3` en `claude/garser-service-production-readiness-65ee05` (desbroce), ambos separados a propósito del resto de su servicio para poder llevarse con `git cherry-pick` sin rehacer nada. Son funcionalmente idénticos (mismo `Math.round(totalHours * 1e6) / 1e6`); basta con cherry-pickear uno de los dos, no ambos. **Ya confirmado con tres servicios (césped, arbustos, desbroce) — no hace falta esperar a más para darlo por genérico.** Falta que alguien lo lleve a `claude/plataforma-transversal` y lo verifique contra los servicios restantes (setos, palmeras, árboles, fitosanitarios). **Nota de despliegue:** este fix ya está en producción (desplegado desde `65ee05` antes de conocer este proceso de coordinación, ver nota de producción en §2) — quien integre `plataforma-transversal` no está estrenándolo, está formalizándolo |

### 3.3 · Menores, comunes a varios servicios

| Dónde | Qué falla |
|---|---|
| Panel del jardinero, tarjeta de solicitud | Dice «Cliente desconocido»: el nombre del cliente no se resuelve |
| Panel del jardinero, tarjeta de solicitud | La cabecera dice «(1h)» donde el bloque es de 3 h, y la misma tarjeta dice «Duración estimada: 3h» más abajo |
| «Mis Reservas» del cliente | El botón «Valorar» no cambia en una reserva ya valorada. El modal sí protege contra duplicados |
| `gardener_profiles` | Dos pares de columnas de valoración (`rating`/`total_reviews` y `rating_average`/`rating_count`). Hoy coinciden; el día que diverjan, el cliente verá una media y el sistema otra |
| Entorno local | Sin `.env.local` en el worktree, 9 ficheros de test fallan por «Falta VITE_SUPABASE_URL». No es un fallo del código: hay que copiarlo del checkout principal |

---

## 4. Cómo se sube un servicio

De uno en uno. Nunca dos a la vez.

1. **Primero, una sola vez:** integrar `claude/plataforma-transversal` en `main`.
2. **Cada chat rebasa su rama sobre `main`** y vuelve a ejecutar su runner. Si el runner
   deja de estar en verde después de rebasar, el conflicto se resolvió mal: hay que mirarlo
   antes de seguir.
3. Integrar **una** rama de servicio en `main`.
4. Ejecutar **todos** los runners que existan, no solo el del servicio recién integrado.
   Es lo único que detecta que arreglar un servicio ha roto otro.
5. Volver al paso 2 con el siguiente servicio.

Un servicio arreglado sobre un motor que después cambia no está arreglado: por eso el
paso 4 no se salta.

---

## 5. Estado de las ramas

| Rama | Servicio | Estado |
|---|---|---|
| `claude/plataforma-transversal` | — (tronco común) | Lista. **Se integra primero** |
| `claude/fitosanitarios-sobre-plataforma` | Servicios fitosanitarios | Lista, apoyada en la anterior. Runner 68/68, 375 tests |
| `claude/garser-service-production-readiness-452e4c` | Servicios fitosanitarios | Rama original, mezcla servicio y tronco común. **Sustituida por las dos de arriba** |
| `claude/garser-service-production-readiness-214f6d` | Césped y setos | En curso |
| `claude/garser-service-production-readiness-71595e` | (por confirmar) | En curso |
| `claude/garser-service-production-readiness-308203` | Poda de árboles | En curso. Fase 3 hecha (1 bug Grave + 2 menores corregidos, código muerto borrado, runner 15/15 con la rama transversal). Falta rehacer el ciclo con pago real (nuevas reglas) antes de dar el informe por cerrado |
| `claude/garser-service-production-readiness-b14a9c` | Poda de plantas y arbustos | En curso. Fase 3 hecha: 2 bloqueantes + 2 graves corregidos, separados en 2 commits (`554914f` servicio, `6a43401` transversal → §3.2-D). Verificado por tests unitarios (62/62 ficheros); **pendiente reejecutar el runner por HTTP contra un stack levantado desde este worktree** (hasta ahora medí contra el checkout compartido, no contra este código — ver nota en §2) y **rehacer el ciclo de pago/cambio de precio/cancelación/reseña con Stripe real** (mi informe los daba por NO PROBADO con las reglas antiguas) |
| `claude/garser-service-production-readiness-65ee05` | Desbroce de malas hierbas | Fase 3 hecha: 1 bloqueante + 1 menor corregidos y propios de esta rama (`993e3cb`), 1 hallazgo transversal aislado (`a2395c3`, mismo bug que `6a43401` de arbustos — ver §3.2-D), puerta de licencia duplicada revertida (ver §2). 359/359 tests unitarios en verde. **Pendiente:** reejecutar `scripts/readiness/desbroce.mjs` por HTTP contra un stack levantado desde este worktree (medí contra el checkout compartido antes de este aviso — mismo caso que arbustos, ver su nota en §2) y rehacer el ciclo de pago/cambio de precio/cancelación/reseña con Stripe real (mi informe los daba por NO PROBADO con las reglas antiguas). **Ya desplegado a producción de forma parcial y desordenada antes de conocer este proceso — ver el aviso de despliegue en §2, es lectura obligatoria antes de tocar `booking-authority`/`booking-payment` en remoto** |
