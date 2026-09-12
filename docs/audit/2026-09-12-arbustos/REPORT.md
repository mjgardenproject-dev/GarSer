# Preparación para producción — Poda de plantas y arbustos

**Veredicto: GO** (tras Fase 3, 2026-09-12 — ver §9)

~~**Veredicto original de Fase 1-2: NO-GO**~~ — los 2 bloqueantes y los 3 hallazgos no
bloqueantes de abajo están corregidos y reverificados. Se conserva el análisis original de
Fase 1-2 tal cual se presentó, y el cierre de Fase 3 con las evidencias de corrección está
en §9.

1. **#1 — El estado de las plantas que detecta la IA nunca llega a la reserva** cuando el
   cliente sube fotos por el botón global "Analizar" (el que la propia pantalla marca
   "Recomendado"): todo macizo descuidado o muy descuidado analizado por ese camino se
   factura y se agenda como si estuviera en estado normal.
2. **#3 — Las horas de una reserva de arbustos no reflejan el recargo de estado real
   configurado por el jardinero**, sino un multiplicador fijo distinto: con la config
   sembrada hoy (20 %/50 %), el calendario reserva sistemáticamente más tiempo del que el
   precio cobrado justifica.

---

## 1. Hallazgos

| # | Severidad | Dimensión | Fase | Ubicación | Qué falla | Fix propuesto |
|---|---|---|---|---|---|---|
| 1 | **Bloqueante** | Paridad IA↔manual / Precio / Tiempo | 1 (código muy directo; el click-through con fotos reales es NO PROBADO — ver §5 y §8) | `src/pages/reserva/DetailsPage.tsx:2385-2411` (bug); compárese con el camino correcto en `DetailsPage.tsx:4084-4145` + `src/pages/reserva/detailsPageAdapters.ts:642-690`; dato disponible desde `supabase/functions/ai-pricing-estimator/index.ts:1475` y `new_prompts.ts:466,500`; botón alcanzable via `src/pages/reserva/detailsPagePresentation.ts:52` (`showsGlobalAnalyzeButton: !isLawn && !isHedge && !isWeeding` → `true` para arbustos) | El manejador bulk `runAIAnalysis` (disparado por el botón global "Analizar", el recomendado en pantalla) construye cada `shrubGroup` sin leer `estado_plantas` del análisis: el objeto empujado a `newShrubGroups` no tiene `state` ni `stateProposedByAI`, a diferencia de los bloques gemelos de césped (`:2265-2268`) y setos (`:2302-2312`), que sí lo asignan. El motor trata `state: undefined` como `'normal'`: nunca aplica el recargo (+20 %/+50 %) ni añade el tiempo correspondiente, aunque Gemini sí pide y devuelve `estado_plantas` (`"normal"/"descuidado"/"muy descuidado"`). Existe un segundo camino, **correcto**: `analyzeShrubGroup` (botón "Analizar esta zona" dentro de un grupo) sí usa `adaptShrubAnalysisResult`, que lee `estado_plantas` y fija `state`/`stateProposedByAI` bien. Ambos botones coexisten en la misma pantalla para arbustos. | En el bloque `else if (normService.includes('poda de plantas'))` de `runAIAnalysis`, añadir la misma lectura de `t.estado_plantas` y el mismo mapeo a `state`/`stateProposedByAI` que ya usa `adaptShrubAnalysisResult` — o, más simple, sustituir ese bloque por una llamada a la función que ya existe y ya está bien, igual que hace `analyzeShrubGroup`. Cambio contenido en el `else if` de arbustos; no toca los bloques de otros servicios. |
| 2 | Grave | Configuración del jardinero → qué puede contratar el cliente | 1 + 2C (confirmado en vivo) | `src/components/gardener/ShrubPricingConfigurator.tsx` (413 líneas, sin ninguna referencia a `condition_surcharges`); tipo sin el campo en `src/types/index.ts:305-323`; default oculto en `src/shared/bookingQuoteCore.ts:237` (`DEFAULT_SHRUB_SURCHARGES = { media: 20, alta: 50 }`) | El jardinero no tiene ningún control en su panel para ver o cambiar el recargo por estado descuidado/muy descuidado — a diferencia de césped, setos y palmeras, que sí lo exponen. El motor factura ese recargo igualmente (usando el valor de BD si existe, o el default 20/50 si no), pero ningún jardinero puede saber que existe ni ajustarlo a su criterio. Confirmado en vivo: el panel "Configurar Poda de plantas y arbustos" no tiene ninguna sección de "Recargo por estado" (sí tiene Precio mínimo, Método de cobro, Velocidad de trabajo, Tarifas por m², Gestión de Residuos). Un jardinero nuevo activando el servicio por primera vez no tendría la clave `condition_surcharges` en absoluto en su config, y quedaría con el 20/50 % de fábrica sin saberlo. | Añadir al configurador una sección "Recargo por estado" con dos campos (equivalente al ya existente en `HedgePricingConfigurator.tsx:533,551`), y añadir `condition_surcharges` al tipo `ShrubPricingConfig`. |
| 3 | **Bloqueante** | Cálculo de tiempo | 2A (confirmado por ejecución) | Bug: `src/shared/bookingQuoteCore.ts:1444` (`getDurationMultiplier(group.state)`); patrón correcto ya usado en el propio bloque de precio: `:445-446` y `:1583-1584` (`resolveSurchargePercent(surcharges.media/alta, DEFAULT_SHRUB_SURCHARGES...)`) | El bloque de HORAS de arbustos usa un multiplicador fijo (+30 % para "descuidado", +70 % para "muy descuidado") que **no coincide** con el `%` real que el jardinero tiene configurado (hoy: +20 %/+50 %) y que el bloque de PRECIO sí usa correctamente. Medido por ejecución con la config real: 20 m² medianas "descuidado" factura 156 € (correcto, +20 % sobre 130 €) pero reserva 3,5 h de calendario en vez de las 3,0 h que corresponderían al mismo +20 %. Con "muy descuidado" + retirada, factura 225 € (correcto) pero reserva 5,0 h en vez de 4,5 h. Es el mismo patrón que césped y setos ya corrigieron en su propio bloque (`bookingQuoteCore.ts`, auditorías 2026-09-11/12); arbustos y desbroce quedaban pendientes, ya anotado en `docs/audit/COORDINACION-SERVICIOS.md`. No es transversal: el fix cabe entero dentro del bloque `if (bookingData.shrubGroups?.length)` de horas, sin tocar `getDurationMultiplier` en sí (sigue viva para desbroce) ni ningún otro servicio. | Sustituir la llamada a `getDurationMultiplier(group.state)` en el bloque de horas por el mismo cálculo de `stateMult` (via `resolveSurchargePercent`) que ya usa el bloque de precio, exactamente como hicieron césped y setos. |
| 4 | Menor | Coherencia con la vida real | 1 + 2A (confirmado por ejecución) | Ausencia en `src/shared/bookingQuoteCore.ts` (no existe `shrub_area_implausible`, a diferencia de `lawn_area_implausible`/`hedge_length_implausible`/`palm_quantity_implausible`/`phytosanitary_area_implausible`); rango manual en `src/shared/manualEntry/manualEntrySchema.ts:360` (`shrub: { superficie_m2: { min: 1, max: 2000 } }`); guía a la IA en `supabase/functions/ai-pricing-estimator/new_prompts.ts:469` ("Residential shrub beds measure between 1 and 500 m2... if exceeds, AMBIGUOUS_SIZE") | No existe ningún aviso de plausibilidad para la superficie de arbustos en el motor. Además hay una asimetría 4x entre lo que la IA considera "ambiguo" para un macizo residencial (>500 m²) y lo que el flujo manual acepta sin ninguna fricción (hasta 2000 m²). Confirmado por ejecución: 600 m² manual se acepta con `warnings: []`, precio 5400 € sin ningún aviso. | Añadir `SHRUB_MAX_PLAUSIBLE_AREA` (alineado con el umbral de 500 m² que ya usa el prompt) y un `pushWarning('shrub_area_implausible', …)`, mismo patrón que los otros 4 servicios ya tienen. |
| 5 | Grave | Persistencia / coherencia precio mostrado vs. autoritativo | 2A (confirmado por ejecución) | `buildShrubBreakdown`, `src/shared/bookingQuoteCore.ts:449` (redondea cada línea con `Math.ceil` individualmente) vs. el `totalPrice` real, `:1587` + `applyMinimumPrice` (redondea la suma una sola vez) | Con 2 o más `shrubGroups` de áreas no enteras, la suma de las líneas del desglose mostrado al cliente puede ser **mayor** que lo realmente cobrado, sin ninguna línea de ajuste (el código solo añade un ajuste cuando `totalPrice > sumaDesglose`, nunca al revés). Medido por ejecución: grupos de 33 m² medianas + 17 m² pequeñas → `totalPrice=291€` pero el desglose suma `292€` (215+77). Alcance: el wizard manual solo permite 1 grupo (`repeatable:false`), pero el flujo de fotos sí permite añadir varios grupos (`addShrubGroup()`), así que es alcanzable en producción. | Redondear cada línea de `buildShrubBreakdown` de forma consistente con el cálculo del total (por ejemplo, sumar en crudo y repartir el redondeo al final, o dejar de redondear por línea y mostrar solo el total redondeado). |

## 2. Papel vs. realidad

`serviceId` real: `649bcd71-514e-4438-ad64-1136172de98a` (el de `references/servicios.md`,
`40798630-...`, es fantasma — no existe en este entorno). Config verificada por SQL:
`prices_per_m2:{pequeñas:4.5,medianas:6.5,grandes:9.0}`,
`yield_m2_per_hour:{pequeñas:12,medianas:8,grandes:5}`,
`condition_surcharges:{media:20,alta:50}`, `waste_removal.percentage:15`,
`minimum_price:45`, `pricing_method:'per_quantity'`.

| Escenario | Predicción Fase 1 | Devuelto por el motor | Desviación |
|---|---|---|---|
| Base — 100 m² medianas normal, sin retirada | 650,00 € · 11,5 h | 650,00 € · 11,5 h | — |
| Mínimo — 1 m² pequeñas normal, sin retirada | 45,00 € · 1 h | 45,00 € · 1 h | — |
| **Recargo "descuidado" — 20 m² medianas** | **156,00 € · 3,0 h** (horas con el mismo 20 % que el precio) | 156,00 € · **3,5 h** | **Horas: +0,5 h (16,7 %) — hallazgo #3** |
| **"Muy descuidado" + retirada — 20 m² medianas** | **225,00 € · 4,5 h** | 225,00 € · **5,0 h** | **Horas: +0,5 h (11 %) — hallazgo #3** |
| Tamaño "pequeñas" aislado — 24 m² normal | 108,00 € · 2 h | 108,00 € · 2 h | — |
| Tamaño "grandes" aislado — 24 m² normal | 216,00 € · 5 h | 216,00 € · 5 h | — |
| Fuera de rango manual — 2001 m² | 422 `manual_input_invalid` | 422 `manual_input_invalid` (verificado por HTTP — ver §5) | — |
| Justo en el límite manual — 2000 m² | 18.000,00 € · 360 h | 18.000,00 € · 360 h | — |
| Asimetría IA/manual — 600 m² manual (hallazgo #4) | Aceptado sin aviso (el motor no tiene red de seguridad) | Aceptado, `warnings: []`, 5.400,00 € | Confirma el hallazgo #4, no es un bloqueante nuevo |
| **Coherencia desglose — 33 m² medianas + 17 m² pequeñas** | El desglose debería sumar exactamente `totalPrice` | `totalPrice=291€`, suma de líneas del desglose = **292€** | **+1 € — hallazgo #5** |

Una desviación distinta de cero en horas o precio es bloqueante. Confirmado por ejecución
(`READINESS_ENGINE=local node scripts/readiness/arbustos.mjs`): **15 PASA · 3 FALLA · 1
NO PROBADO** (las 3 fallas son los hallazgos #3 ×2 y #5; el NO PROBADO es la validación de
rango manual, que no vive en el motor y se confirmó aparte por HTTP).

## 3. Barrido de variables

Caso base del barrido: 200 m² medianas normal, sin retirada → 1.300,00 € · 22,5 h.

| Clave de `additional_config` | Delta esperado | Delta observado | Veredicto |
|---|---|---|---|
| `prices_per_m2.pequeñas` | −400,00 € | −400,00 € (−30,8 %) | PASA |
| `prices_per_m2.grandes` | +500,00 € | +500,00 € (+38,5 %) | PASA |
| `condition_surcharges.media` (descuidado) | +260,00 € (20 %) | +260,00 € (20,0 %) | PASA |
| `condition_surcharges.alta` (muy_descuidado) | +650,00 € (50 %) | +650,00 € (50,0 %) | PASA |
| `waste_removal.percentage` | +195,00 € (15 %) | +195,00 € (15,0 %) | PASA |

Toda clave configurada mueve el precio en la proporción correcta — el bloque de PRECIO de
arbustos está bien cableado a la config del jardinero para las 5 claves. El problema (#3)
está exclusivamente en el bloque de HORAS, que no forma parte de este barrido porque mide
solo precio; se demuestra aparte en la tabla de §2.

## 4. Matriz de paridad

| Variable | Config jardinero | Flujo IA (botón global) | Flujo IA (por zona) | Flujo manual | Motor | Veredicto |
|---|---|---|---|---|---|---|
| Tamaño (pequeñas/medianas/grandes) | ✓ | ✓ | ✓ | ✓ | ✓ | OK |
| Estado (normal/descuidado/muy descuidado) | ✗ (hallazgo #2: sin UI) | ✗ (hallazgo #1: se pierde) | ✓ | ✓ | ✓ (cuando le llega) | **Roto**: el mismo macizo cuesta y agenda distinto según el botón de análisis que use el cliente |
| Retirada de restos | ✓ | ✓ | ✓ | ✓ | ✓ | OK |
| Superficie (m²) | ✓ (yields) | ✓ | ✓ | ✓ (con tope 2000, sin aviso de plausibilidad — hallazgo #4) | ✓ | OK con matiz |

## 5. Guion de Fase 2

| Paso | Resultado | Evidencia |
|---|---|---|
| 2A — 15 escenarios/barridos/disponibilidad vía `READINESS_ENGINE=local` | 15 PASA / 3 FALLA / 1 NO PROBADO | Ver §2 y §3; salida completa del runner en el historial de esta sesión |
| 2A — validación de rango manual (2001 m²) | PASA, verificado por HTTP aparte (no vive en `bookingQuoteCore.ts`, así que `READINESS_ENGINE=local` no lo prueba) | `{"error":"Algunos datos introducidos están fuera de los valores permitidos.","code":"manual_input_invalid","validationErrors":[{"field":"shrubGroups[0].area","code":"out_of_range","message":"la superficie de arbustos debe estar entre 1 y 2000."}]}` |
| 2C.a — Configurador del jardinero | **FALLA (confirma hallazgo #2)** | Texto completo del panel "Configurar Poda de plantas y arbustos": Precio mínimo, Método de cobro, Velocidad de trabajo, Tarifas por m², Gestión de Residuos — sin ninguna mención a recargo por estado. `updated_at` de la config sin cambiar tras abrir el panel (`2026-09-06 00:43:35`, sin autoguardado en el primer render — arbustos queda descartado para ese patrón, a diferencia de setos/palmeras) |
| 2C.b — Wizard manual completo como cliente | PASA | 20 m², Medianas, Normal, sin retirada → pantalla de selección de jardinero: `130,00 € al profesional + 16,25 € gestión = 146,25 €`, `2.5 h`. Coincide exactamente con el motor (20×6,5=130; 130×0,125=16,25; 20/8=2,5h) |
| 2C.c — Listado de jardinero / cobertura | PASA (vía runner 2A) | Marbella incluye al jardinero; Madrid excluido con `outside_coverage`; domingo sin huecos |
| 2C.d — Reserva hasta pantalla de pago | PASA | Resumen de pago idéntico en las tres pantallas: `146,25 €` total, `16,25 €` gestión, `130,00 €` al profesional |
| 2C.e — Pago con tarjeta de test | **PASA** | PaymentIntent `pi_3UEpNG2MwFyGXuB70MgLFiNM`: `requires_capture`, `amount_capturable=1625` tras el pago del cliente |
| 2C.f — Aceptación del jardinero (captura) | **PASA** | `bookings.status: pending → confirmed`; Stripe: `pi_3UEpNG2MwFyGXuB70MgLFiNM` → `succeeded`, `amount_received=1625` |
| 2C.g — Cancelación con reembolso | **PASA** | `bookings.status → cancelled`, `cancellation_actor='client'`; Stripe: `GET /v1/refunds?payment_intent=pi_3UEpNG2MwFyGXuB70MgLFiNM` → `re_3UEpNG2MwFyGXuB70huubLjy`, `amount=1625`, `status=succeeded` |
| 2C.h — Cambio de precio (propuesta/aceptación) | NO PROBADO | No se encontró en el tiempo disponible la vía de UI para proponer un cambio de precio sobre una reserva ya `confirmed` (el panel de "Modificar precio" solo apareció en la lista de solicitudes *pendientes*, antes de aceptar). El mecanismo es compartido (RPC `respond_booking_price_change`) y **T4** (`docs/audit/COORDINACION-SERVICIOS.md` §3.2) ya lo reprodujo con evidencia real en césped y árboles: `duration_hours` no se actualiza al aceptar un cambio de precio. No hay razón para esperar que arbustos sea diferente, pero no se ha comprobado específicamente con este servicio |
| 2C.i — Finalización, reseña y volver a reservar | NO PROBADO | La reserva de prueba quedó cancelada (paso g) antes de llegar a la fecha del servicio (18 de septiembre); no hay forma de completarla en el tiempo real de esta sesión. El mecanismo de reseña de penalización/reseña real ya está verificado de forma genérica en auditorías anteriores |
| 2B — Flujo IA por contrato (fotos → Storage → `ai-pricing-estimator`) | NO PROBADO | No se realizó por límite de tiempo frente al resto del alcance; el hallazgo #1 ya se estableció con evidencia de código suficiente (ver §1) |
| Subida de fotos por la UI (botón global vs. por zona, click-through real) | NO PROBADO | El panel Browser no tiene herramienta de subida de ficheros (limitación conocida de la skill). Confirmado en cambio que **ambos** botones de análisis (el global "recomendado" y el "Analizar esta zona" por grupo) coexisten y son alcanzables en la pantalla de arbustos |

## 6. Red de regresión

Runner reescrito desde cero (el heredado de la tanda anterior usaba un `serviceId`
fantasma y predicciones de otra base de código): `scripts/readiness/arbustos.mjs`

```bash
READINESS_ENGINE=local node scripts/readiness/arbustos.mjs
```

Sale con código 1 mientras los hallazgos #3 y #5 sigan sin corregir (eso es lo esperado
hoy: son la evidencia, no un fallo del runner). El Escenario 6 (rango manual) se marca
`NO PROBADO` a propósito en modo local — ver comentario en el propio fichero.

## 7. Hallazgos transversales

Ninguno **nuevo**. Reproducidos y observados durante esta auditoría, ya documentados en
`docs/audit/COORDINACION-SERVICIOS.md` §3.2 — no se vuelven a anotar, solo se listan aquí
para que conste que arbustos también los sufre:

- **T6** (cosmético): en "Solicitudes de Reserva" del jardinero, la cabecera mostraba
  `12:00:00 - 15:00:00 (1h)` para una reserva de arbustos de 3h reales (correcto un poco
  más abajo, "Duración estimada: 3h"). Mismo componente genérico (`BookingRequestsManager.tsx:502`).
- **T7**: 100 m² de arbustos en estado normal (11,5 h) dejó al jardinero sin ningún hueco
  reservable en ninguna fecha, con el mismo mensaje genérico "No hay profesionales
  disponibles" que no distingue "prueba otro día" de "este trabajo no cabe nunca". Tuve que
  reducir a 20 m² para poder completar el resto del ciclo de vida.
- **T9**: la solicitud de arbustos también mostraba "Cliente desconocido" en el panel del
  jardinero pese a ser Laura Fernández (confirmada por nombre en "Mis Reservas" del mismo
  jardinero). Mismo componente, mismo bug de `client_id` vs. `profiles.user_id`.
- **T4** (no re-verificado específicamente para arbustos, ver §5 2C.h): se asume aplicable
  por ser una RPC compartida ya reproducida en 2 servicios.

No se ha encontrado ningún hallazgo transversal **nuevo** que añadir a §3.2.

## 8. Acciones manuales del usuario

- **Nada que desplegar todavía** — esta auditoría es de solo lectura salvo por el runner y
  estas notas; no se ha tocado el motor, el configurador ni ningún fichero de producción.
  Los 5 hallazgos esperan autorización para pasar a Fase 3.
- **NO PROBADO — requiere cierre manual o en una sesión futura:**
  - 2B (flujo IA por contrato HTTP con fotos reales subidas a Storage): confirmar el
    hallazgo #1 con una llamada real a `ai-pricing-estimator`, no solo por lectura de
    código.
  - 2C.h (cambio de precio sobre una reserva confirmada de arbustos): localizar la UI
    correcta y repetir la reproducción de T4 específicamente para este servicio.
  - 2C.i (finalización + reseña + volver a reservar): necesita una reserva que llegue a su
    fecha real, o adelantar el reloj del entorno de pruebas.
  - Subida de fotos real por la UI (botón global vs. por zona): el panel Browser no puede
    subir ficheros; haría falta Playwright/Cypress o una sesión con acceso a un
    `<input type=file>` real para confirmar en un clic literal que el botón "recomendado"
    es el que dispara el camino roto.
- **Entorno**: recordar que `~/Downloads/GarSer-referencia` iba (al empezar esta sesión) 1
  commit por detrás de `origin/main` (el de la auditoría de fitosanitarios). No afectó a
  nada de lo medido aquí (2A fue en proceso; 2C usó Stripe/DB reales, no el motor
  desplegado por HTTP), pero conviene confirmar que ya está al día antes de la siguiente
  auditoría que dependa de `booking-authority` por HTTP.
- Arranqué el servidor de desarrollo de este worktree (puerto 5185) manualmente por Bash
  en vez de con `preview_start`, porque la herramienta de preview de esta sesión resolvía
  el `launch.json` del worktree de fitosanitarios (puerto 5187, ocupado legítimamente por
  esa otra sesión) en lugar del mío. Verificado con `lsof`/`cwd` del proceso que el
  servidor sirve genuinamente `/Users/javier/Downloads/auditorias/arbustos`. Queda
  corriendo; puede pararse con normalidad.

---

## 9. Cierre de Fase 3 (2026-09-12) — autorizada por el usuario

Los 5 hallazgos corregidos, cada uno contenido en el bloque/fichero de arbustos, sin tocar
ningún bloque de otro servicio ni ninguna función compartida en sí misma (solo el bloque
`if (bookingData.shrubGroups?.length)` de `bookingQuoteCore.ts`, que es "de arbustos"):

| # | Fix | Fichero | Verificado |
|---|---|---|---|
| 1 | El botón global "Analizar" ahora lee `t.estado_plantas` (ya lo devuelve `ai-pricing-estimator`, faltaba tipar y leer) y fija `state`/`stateProposedByAI` en el `shrubGroup`, igual que ya hacía el camino "Analizar esta zona" (`adaptShrubAnalysisResult`) | `src/pages/reserva/DetailsPage.tsx:2395-2421`; tipo añadido en `src/utils/aiPricingEstimator.ts` (`AITask.estado_plantas`) | `tsc` limpio (172→172); no se pudo probar el clic real con fotos (limitación de subida de ficheros del panel), pero la lectura del dato y su paso al `shrubGroup` ya están en su sitio |
| 2 | Nueva sección "Recargo por Estado" (Descuidadas/Muy descuidadas) en el configurador del jardinero; `condition_surcharges` añadido al tipo `ShrubPricingConfig` | `src/components/gardener/ShrubPricingConfigurator.tsx`, `src/types/index.ts` | **Confirmado en vivo**: el panel ya muestra los dos campos con los valores reales de BD (20 %/50 %); `updated_at` de la config sin cambiar tras abrir el panel (sin autoguardado espurio) |
| 3 | Las horas de arbustos ya usan `resolveSurchargePercent(condition_surcharges.media/alta, …)`, el mismo % que el precio, en vez del `getDurationMultiplier` fijo | `src/shared/bookingQuoteCore.ts` (bloque de horas de arbustos) | **Confirmado por ejecución**: 20 m² medianas "descuidado" → `156,00 € · 3 h` (antes 3,5 h); "muy descuidado" + retirada → `225,00 € · 4,5 h` (antes 5 h) |
| 4 | Nuevo aviso `shrub_area_implausible` a partir de 500 m² (mismo umbral que ya usa el prompt de Gemini) | `src/shared/bookingQuoteCore.ts` (`SHRUB_MAX_PLAUSIBLE_AREA_M2`) | **Confirmado por ejecución**: 600 m² manual sigue aceptándose (el tope manual sigue en 2000, sin cambios) pero ahora devuelve `warnings:[{"code":"shrub_area_implausible",...}]` |
| 5 | `buildShrubBreakdown` reparte el redondeo entre líneas (todas menos la última al `Math.round` normal, la última absorbe el resto) para que la suma coincida siempre con el total | `src/shared/bookingQuoteCore.ts` (`buildShrubBreakdown`) | **Confirmado por ejecución**: 33 m² + 17 m² → desglose `215+76=291€` = `totalPrice=291€` (antes `215+77=292€ ≠ 291€`) |

**Verificación de cierre:**

```bash
READINESS_ENGINE=local node scripts/readiness/arbustos.mjs
```
→ **18 PASA · 0 FALLA · 1 NO PROBADO** (el NO PROBADO sigue siendo la validación de rango
manual, que no vive en el motor — confirmada aparte por HTTP como PASA, sin relación con
estos 5 fixes).

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"
```
→ **172** antes de tocar nada, **172** después (medido con `git stash`/`git stash apply`
para aislar exactamente el delta; se detectó y corrigió 1 error nuevo real —
`AITask.estado_plantas` sin tipar— antes de este resultado final).

```bash
npx vitest run
```
→ **437/437** (sin cambios respecto a antes de los fixes).

**No se ha tocado**: ningún configurador de otro servicio, ningún bloque de
`bookingQuoteCore.ts` fuera del de arbustos, `getDurationMultiplier` en sí (sigue viva para
desbroce), ni `_harness.mjs`. El runner (`scripts/readiness/arbustos.mjs`) es el único
fichero de "infraestructura de auditoría" modificado, junto con este informe y el registro
de coordinación.

**Pendiente, sin cambios respecto a la Fase 2** (ver §8): 2B por contrato HTTP con fotos
reales, 2C.h (cambio de precio específico de arbustos), 2C.i (finalización/reseña/volver a
reservar), y la subida de fotos real por la UI. Ninguno de estos bloquea el veredicto GO:
son huecos de cobertura de prueba, no comportamientos incorrectos detectados.

La PR la abre el usuario, como corresponde.

---

## 10. Segunda ronda de verificación en vivo (2026-09-12, a petición del usuario)

El usuario pidió explícitamente volver a probar en vivo, incluido lo marcado NO PROBADO.
Se hizo, con navegador real contra `http://localhost:5185` (mi propio servidor), cuentas
sembradas y Stripe de test. Hallazgo importante que esto sacó a la luz:

### 10.1 · El fix de horas (#3) NO se ve reflejado en el precio que muestra `ProvidersPage`

Repetí el wizard manual con 20 m² medianas "descuidado": el precio mostrado fue correcto
(156,00 €) pero las horas mostraron **3,5 h** (el valor de ANTES del fix), no las 3 h
esperadas. Investigado con `read_network_requests`: esa pantalla llama por HTTP a
`http://127.0.0.1:54321/functions/v1/booking-authority`, que es la función edge **desplegada
desde `~/Downloads/GarSer-referencia`** (el checkout compartido), no desde este worktree.
Respuesta real capturada:

```json
{"totalPrice":156,"estimatedHours":3.5,"warnings":[]}
```

Esto **no invalida el fix** — `READINESS_ENGINE=local` (usado en §2 y confirmado en 18
PASA/0 FALLA) ejecuta el `bookingQuoteCore.ts` real de este worktree vía esbuild, in-process,
sin pasar por la función edge. Es la única forma de comprobar un cambio de motor *antes* de
desplegar, y así lo dice la propia skill. Lo que este hallazgo confirma es que **el precio y
las horas que ve un cliente real en `garser.es` hoy siguen siendo los de ANTES del fix**,
hasta que esta rama se mezcle y se redespliegue `booking-authority` — exactamente el mismo
aviso que ya dejó la auditoría de fitosanitarios sobre el orden de despliegue.

**Acción manual añadida:** al desplegar, verificar con el mismo wizard (20 m² medianas
descuidado) que la web ya muestra 3 h y no 3,5 h, como prueba de humo de que el redespliegue
surtió efecto.

### 10.2 · Confirmado con fotos reales: bloqueado por falta de `GOOGLE_API_KEY`, no por falta de esfuerzo

Siguiendo el método que describe la propia skill (§2B) — subir fotos reales al bucket
`booking-photos` con la service_role key, generar URL firmada y llamar a
`ai-pricing-estimator` por HTTP, sin necesitar `<input type=file>` — subí una imagen de
prueba y llamé a la función real:

```json
{"reasons":["PROVIDER_AUTH_MISSING"],"analysis_v2":{"error_code":"PROVIDER_AUTH_MISSING",...}}
```

Este entorno local no tiene `GOOGLE_API_KEY` configurada — Gemini no es alcanzable en
absoluto, con o sin fotos reales de arbustos. No es la limitación de subida de ficheros ya
señalada antes: es que el proveedor de IA no está configurado en este Supabase local. El
hallazgo #1 sigue sin poder demostrarse con una clasificación real de Gemini; la corrección
está verificada por tipo (`tsc`) y por equivalencia exacta con el camino gemelo ya correcto
(`adaptShrubAnalysisResult`), no por una llamada real con éxito.

### 10.3 · Cambio de precio (2C.h) — sí probado, con evidencia real, y confirma T4 para arbustos

Localizado el mecanismo real: el botón "Proponer" solo existe mientras la reserva está
**pendiente** (antes de aceptar) — ni en "Mis Reservas" ni en el chat de una reserva ya
`confirmed` hay forma de proponer un cambio (`canGardenerProposePrice` exige
`bookingMeta.status === 'pending'`, `ChatWindow.tsx:103`). Mi caracterización anterior
("cambio de precio sobre una reserva confirmada") era imprecisa: se propone ANTES, y es la
aceptación del cliente la que confirma la reserva al nuevo precio.

Reproducido de punta a punta con una reserva nueva (10 m² pequeñas, 45 €/1h): el jardinero
propuso 130 € por el chat de solicitudes, el cliente lo aceptó desde `/bookings`. Resultado
en BD:

```
status: confirmed · total_price: 130.00 · price_change_status: accepted
duration_hours: 1 (SIN CAMBIAR) · start_time/end_time: sin cambiar (08:00-09:00)
```

El precio pasó de 45 € a 130 € (casi el triple) y las horas/el hueco de calendario **no se
movieron**. Esto es **T4** (ya documentado en `COORDINACION-SERVICIOS.md` §3.2, reproducido
antes en césped y árboles) — confirmado ahora también para arbustos, con evidencia propia.
No es un hallazgo nuevo ni algo que mis 5 fixes debieran tocar (la RPC compartida
`respond_booking_price_change` no pasa por `bookingQuoteCore.ts`); se deja anotado aquí
como refuerzo de que arbustos no es una excepción.

### 10.4 · Resumen honesto de qué se probó en vivo y qué no

| Hallazgo | ¿Probado en vivo? | Cómo |
|---|---|---|
| #2 (configurador) | **Sí** | Navegador real, sección nueva visible con valores de BD, sin autoguardado |
| #3 (horas) | Solo en proceso (`READINESS_ENGINE=local`), NO en el navegador | El navegador llama a la función edge desplegada, que no tiene mi fix hasta redesplegar (§10.1) |
| #1 (estado IA) | No, bloqueado por falta de `GOOGLE_API_KEY` en este entorno (§10.2) | — |
| #4, #5 | Solo en proceso, mismo motivo que #3 | — |
| Ciclo de vida genérico (pago, aceptación, cancelación+reembolso, cambio de precio) | **Sí**, con Stripe real | §5 y §10.3 |
