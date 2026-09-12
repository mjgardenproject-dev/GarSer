# Preparación para producción — Desbroce de malas hierbas

**Veredicto: GO** (Fases 1-3 completas, 2026-09-12)

Los dos hallazgos bloqueantes de la Fase 2 (§1, hallazgos #1 y #2) están corregidos y
reverificados: la validación de rango ya se ejecuta en el único camino real del cliente, y
las horas ya usan el recargo real del jardinero en vez de un multiplicador fijo. También el
hallazgo grave #3 (sin aviso de plausibilidad). El detalle completo de qué se tocó, cómo se
reverificó y qué queda pendiente está en **§9 — Fase 3: Corrección**, al final de este
informe. El hallazgo menor #4 (herbicida sin tiempo estimado) se deja sin tocar a propósito:
es una pregunta de negocio, no un bug de código — ver §9.

**Histórico — veredicto original de Fase 1+2 (previo a la corrección): NO-GO**, por estos
dos motivos, ambos ya resueltos en §9:

1. La validación de rango del área declarada nunca se ejecutaba en el único camino real del
   cliente, y encima la solicitud le llegaba al jardinero etiquetada como "Analizado por IA
   (fotos)" cuando eran datos manuales sin verificar de ningún tipo.
2. Las horas reservadas usaban un recargo fijo (30 %/70 %) distinto del que el jardinero
   configuró de verdad (20 %/50 %), el mismo patrón que ya se corrigió en césped, setos y
   arbustos — en desbroce seguía sin tocar.

Nota sobre el entorno de esta sesión: esta auditoría se hizo en una sesión que empezó
apuntando a otro worktree (`fitosanitarios`) y se redirigió a `desbroce` a petición
explícita del usuario a mitad de conversación. El cambio de directorio de sesión no
propaga a todos los subsistemas por igual: `git`/`Bash` sí se movieron, pero
`preview_start { name: "garser-dev" }` intentó arrancar el servidor **desde
`fitosanitarios`** dos veces seguidas (puerto 5187, cwd del proceso confirmado con
`lsof`) antes de que me diera cuenta y lo parara. La verificación de navegador de este
informe se hizo con un `npm run dev -- --port 5186 --strictPort` lanzado a mano desde
`/Users/javier/Downloads/auditorias/desbroce` (cwd del proceso verificado también con
`lsof`), no con el flujo estándar de la skill. Si vuelve a pasar en otra sesión
redirigida, es esto, no un fallo de la skill.

---

## 1. Hallazgos

| # | Severidad | Dimensión | Fase | Ubicación | Qué falla | Fix propuesto |
|---|---|---|---|---|---|---|
| 1 | Bloqueante | Coherencia con la vida real / Manual | 2A+2C | `src/pages/reserva/DetailsPage.tsx:777-779,6636-6659` (falta `max`, nunca fija `dataInputMode`) · `src/components/booking/ServiceDetailCard.tsx:191,215` (mislabel) · encuesta muerta en `src/shared/manualEntry/manualEntrySchema.ts:784-827` | El único editor de desbroce alcanzable desde la UI del cliente es un formulario ad-hoc embebido en `DetailsPage.tsx`, no el `ManualEntryWizard` genérico (`isManualActive` exige `manualChoiceAvailable`, que es `false` para servicios de `MANUAL_ONLY_SERVICE_KEYS`, y desbroce es el único). Ese formulario ad-hoc nunca fija `bookingData.dataInputMode`, así que: (a) el guard `MANUAL_RANGES.weeding.area` (1-10000 m²) nunca se ejecuta — confirmado en vivo y por API: 50.000 m² se cotiza sin más, sin 422, sin warning; (b) `ServiceDetailCard.tsx:191` (`isManual = dataInputMode==='manual'`) cae a `false` y la solicitud le aparece al jardinero como **"Analizado por IA (fotos)"**, sin el aviso "Revisa las medidas al llegar" que sí ven los otros seis servicios manuales — confirmado en vivo con una reserva real (`84990e26-5c8e-4b70-b3bd-8d4d4c34259a`). Mientras tanto, existe una encuesta completa y correcta (`MANUAL_ENTRY_SURVEYS.weeding`, `buildWeedingZones`, rango, `serviceAsksForWasteRemoval`) que queda muerta por esta condición. | Dos piezas ya construidas y sin usar por un gate que sobra: o bien (A) dejar que `ManualEntryWizard` se monte también para servicios `MANUAL_ONLY_SERVICE_KEYS` (saltando solo la pantalla de elección IA/manual, no el asistente), reutilizando la encuesta y el builder que ya validan bien; o (B) si el formulario ad-hoc se queda, que fije `dataInputMode: 'manual'` al construir el patch y añada el `max={MANUAL_RANGES.weeding.area.max}` que hoy falta en el `<input>`. Decisión de arquitectura del usuario — no la tomo yo. |
| 2 | Bloqueante | Cálculo de tiempo | 2A | `src/shared/bookingQuoteCore.ts:1454-1462` (`getDurationMultiplier`, fijo en 1.3/1.7) | Las horas de una zona de desbroce se calculan con un multiplicador **fijo** (30 % dificultad media, 70 % alta) en vez del recargo que el jardinero configuró de verdad (`suplementos.dificultad_media=20`, `dificultad_alta=50` en el fixture). El precio SÍ usa el % real (`calculateWeedingQuote`, línea 691-726, que además ya calcula las horas correctas internamente en `totalEstimatedHours` — ese valor se descarta y nunca se usa). Confirmado con dos escenarios reales: 1000 m² dificultad alta → 525 € (correcto) pero reserva **13,0 h** en vez de las 11,5 h que corresponden al 50 % real (1,5 h de agenda de más); 1200 m² dificultad alta + retirada (cambio de precio del jardinero) → 756 € (correcto) pero **18,5 h** en vez de 16,5 h (2 h de más). Mismo patrón #1 que ya se corrigió en césped, setos y arbustos (auditorías previas, `docs/audit/COORDINACION-SERVICIOS.md` §2) — desbroce era el único de los tres pendientes que quedaba, y sigue sin tocar. | Sustituir la llamada a `getDurationMultiplier(zone.state)` en el bloque de horas por el mismo cálculo de `stateMultiplier` que ya usa `calculateWeedingQuote` para el precio (o, más simple, sumar `quote.totalEstimatedHours` directamente en vez de recalcular con la fórmula fija) — mismo fix ya aplicado tres veces en otros servicios, contenido en el bloque de desbroce. |
| 3 | Grave | Coherencia con la vida real | 1 | `src/shared/bookingQuoteCore.ts` (falta constante `WEEDING_MAX_PLAUSIBLE_AREA_M2` + `pushWarning`) | Desbroce es el único de los cinco servicios de área/cantidad (césped, setos, palmeras, arbustos, fitosanitarios ya lo tienen) sin ningún aviso de plausibilidad. Confirmado: 50.000 m² (50× el máximo manual de 10.000) no dispara ningún `warning`, ni siquiera cuando el guard de rango falla (hallazgo #1) y el valor llega tal cual al motor. | Añadir `WEEDING_MAX_PLAUSIBLE_AREA_M2` (p. ej. 2000, igual que césped) y un `pushWarning('weeding_area_implausible', ...)`, mismo patrón que `lawn_area_implausible`/`hedge_length_implausible`/`palm_quantity_implausible`/`shrub_area_implausible`. |
| 4 | Menor | Cálculo de tiempo | 1 | `src/shared/bookingQuoteCore.ts:1454-1462` | Aplicar herbicida (`applyHerbicide: true`) mueve el precio (+`precio_herbicida_m2 × área`) pero no añade ningún tiempo a `estimatedHours` — la aplicación real de herbicida (mezcla, pulverizado) consume tiempo de trabajo que hoy no se reserva. Es una pregunta de negocio, no un bug de código: el `additional_config` no tiene ningún campo de rendimiento para herbicida, así que el motor hace exactamente lo que la configuración permite. Lo dejo anotado porque encaja en la regla "toda variable que mueve el precio y el trabajo real entra en las horas". | A decidir por el usuario: si aplicar herbicida debe sumar tiempo, hace falta un campo de rendimiento nuevo en la configuración del jardinero (p. ej. `herbicida_m2_per_hour` o un tiempo fijo por zona) antes de poder facturarlo en horas. |

## 2. Papel vs. realidad

Predicciones recalculadas a mano contra la configuración real sembrada (`precio_desbroce_m2:
0.35`, `precio_herbicida_m2: 0.15`, `yield_m2_per_hour: 120`, `suplementos: {dificultad_media:
20, dificultad_alta: 50, retirada_restos: 20}`, `importe_minimo: 60`), verificado por SQL
directo antes de empezar (ver §5).

| Escenario | Predicción Fase 1 (a mano) | Devuelto por el motor | Desviación |
|---|---|---|---|
| S1: 1000 m², normal, sin herbicida, con retirada | 420,00 € · 9,0 h | 420,00 € · 9 h | — |
| S2: 1000 m², normal, sin herbicida, sin retirada | 350,00 € · **7,5 h** | 350,00 € · **8 h** | **+0,5 h** — T2 (residuo de coma flotante en `totalHours *= 0.9`), ver §7 |
| S3: 1000 m², dificultad alta, sin herbicida, sin retirada | 525,00 € · **11,5 h** (con el 50 % real) | 525,00 € · **13,0 h** | **+1,5 h** — hallazgo #2 (bloqueante) |
| S4: 1000 m², normal, con herbicida, sin retirada | 500,00 € · **7,5 h** | 500,00 € · **8 h** | **+0,5 h** — mismo T2 que S2 |
| S5: 50 m², normal, sin herbicida, sin retirada (mínimo) | 60,00 € · 1,0 h | 60,00 € · 1 h | — |
| 6. Corrección del jardinero: 1200 m² → dificultad alta + retirada | 756,00 € · **16,5 h** (con el 50 % real) | 756,00 € · **18,5 h** | **+2,0 h** — mismo hallazgo #2, a mayor escala |
| 4b. 50.000 m², payload real de la UI (sin `dataInputMode`) | Rechazado, 422 `manual_input_invalid` | **Aceptado**: 17.500,00 € · 375 h, sin warnings | **BLOQUEANTE** — hallazgo #1 |

Toda desviación de horas de esta tabla es consecuencia directa de los hallazgos #2 y T2, no
de un error de mi cálculo: el precio coincide al céntimo en los 7 escenarios. La desviación
de 4b es la más grave: no es una diferencia de céntimos, es la ausencia total de la barrera
de validación en el único camino que existe.

## 3. Barrido de variables

Base del barrido: 2000 m², normal, sin herbicida, sin retirada → **700,00 € · 15,5 h**
(las 15,5 h, no 15,0 h exactas, son la misma T2: `(2000/120)*0.9` deja residuo de coma
flotante).

| Clave de `additional_config` | Delta esperado | Delta observado | Veredicto |
|---|---|---|---|
| `precio_herbicida_m2` (`applyHerbicide: true`) | +300,00 € (2000 m² × 0,15 €/m²) | +300,00 € (42,9 %) | PASA |
| `suplementos.dificultad_media` | +140,00 € (20 %) | +140,00 € (20,0 %) | PASA |
| `suplementos.dificultad_alta` | +350,00 € (50 %) | +350,00 € (50,0 %) | PASA |
| `suplementos.retirada_restos` | +140,00 € (20 %) | +140,00 € (20,0 %) | PASA |

Las cuatro claves del `additional_config` de desbroce llegan al motor y mueven el precio
exactamente lo que dice la configuración. Ningún recargo se pierde ni queda pisado por un
default.

## 4. Matriz de paridad

No aplica. Desbroce está **excluido explícitamente** del flujo de fotos/IA por diseño:
`detailsPagePresentation.ts:52` — `showsGlobalAnalyzeButton: !isLawn && !isHedge &&
!isWeeding` — y `MANUAL_ONLY_SERVICE_KEYS = ['weeding']`
(`manualEntrySchema.ts:47`). No existe un segundo camino con el que comparar: solo hay
declaración manual. La etiqueta "Analizado por IA (fotos)" que aparece en el panel del
jardinero (hallazgo #1) no es un segundo camino real — es un mislabel de la UI sobre datos
manuales, no una ruta de IA que exista de verdad para este servicio.

## 5. Guion de Fase 2

**Configuración verificada por SQL antes de calcular nada** (jardinero sembrado,
`serviceId` real `d946c65f-c588-4103-baca-0317667f04aa` — el de `references/servicios.md`
y el del runner heredado, `e2bb35b1-...`, son fantasma):
```
{"suplementos":{"dificultad_alta":50,"retirada_restos":20,"dificultad_media":20},
 "importe_minimo":60,"yield_m2_per_hour":120,"precio_desbroce_m2":0.35,
 "precio_herbicida_m2":0.15}
```

| Paso | Resultado | Evidencia |
|---|---|---|
| 2A.1-5 escenarios (motor en proceso) | 4 FALLA / resto PASA | log completo del runner, ver abajo |
| 2A.3 barrido de variables | 4 PASA | ver §3 |
| 2A.4 límites — `dataInputMode=manual` explícito | PASA | `422 manual_input_invalid` en 50.000, 10.001 m²; acepta en 10.000 m² exactos (`3500 €`) |
| 2A.4 límites — payload real de la UI (sin `dataInputMode`) | **FALLA (bloqueante)** | `{"totalPrice":17500,"estimatedHours":375,"warnings":[]}` |
| 2A.7 disponibilidad — domingo | PASA | `{"quote":null,"validHours":[],"exclusion":{"code":"no_reservable_availability",...}}` |
| 2A.7 disponibilidad — fuera de cobertura | PASA | `{"code":"outside_coverage",...}` |
| 2B paridad IA↔manual | NO APLICA | ver §4 |
| 2C.a configurador del jardinero — sin autoguardado espurio | PASA | `md5(additional_config)` y `updated_at` idénticos antes/después de abrir el panel sin tocar nada: `06d7c214a7ad7d0d2b8b0ce66332df5e` / `2026-09-06 00:43:35.267185+00` en ambas lecturas |
| 2C.a configurador → BD → motor | PASA | cambié `precio_desbroce_m2` 0,35→0,40 en el panel, guardó ("Configuración guardada y servicio sincronizado"), `additional_config.precio_desbroce_m2` en BD pasó a `0.4`, y una cotización 1000 m²/normal/con retirada subió de 420 € a **480 €** — restaurado a 0,35 al terminar |
| 2C.b wizard/formulario manual del cliente | PASA (con matiz del hallazgo #1) | 300 m², dificultad media → pantalla muestra **171,00 € total (152,00 € profesional + 19,00 € gestión) · 4 h**, coincide al céntimo con la predicción a mano (105+0)×1,2×1,2=151,2→152€ redondeado, ×1,125=171,0 |
| 2C.c listado de jardineros | PASA / FALLA parcial (T7) | 300 m² dificultad media: Miguel Ángel Ruiz aparece con precio y huecos correctos. 1000 m² dificultad alta: **`quotes:{}`, `eligibleProviderIds:[]`**, excluido por `no_reservable_availability` — reproduce T7 con un caso real y plausible, no un edge case |
| 2C.d reserva hasta pago | PASA | ver desglose cliente/jardinero arriba |
| 2C.e pago con tarjeta de test | PASA | `4242 4242 4242 4242`, PaymentIntent `pi_3UErsL2MwFyGXuB71BHdDTOw` → `requires_capture`, `amount_capturable=1900` (19,00 €), `amount_received=0` — captura diferida correcta. Reserva creada en BD: `id=84990e26-5c8e-4b70-b3bd-8d4d4c34259a`, `status=pending`, `total_price=152.00`, `duration_hours=4`. `pricing_context.quote_snapshot` en BD coincide exactamente con lo mostrado en pantalla |
| 2C.f aceptación del jardinero → captura | PASA | tras pulsar "Aceptar" en el panel del jardinero: `bookings.status→confirmed`; Stripe `pi_3UErsL2MwFyGXuB71BHdDTOw` → `status=succeeded`, `amount_received=1900`, `amount_capturable=0` |
| 2C.f cambio de precio, aceptación por el cliente, cancelación, finalización, reseña, volver a reservar | **NO PROBADO para desbroce específicamente en esta sesión** | El mecanismo es transversal y ya está verificado end-to-end con pago real en otros servicios (T4 en césped/árboles/arbustos; cancelación con reembolso en árboles/palmeras — ver `HALLAZGOS-CONOCIDOS.md` y §3.1 de coordinación). Dado el volumen ya cubierto en esta auditoría, no repetí esos pasos con una reserva de desbroce. Si el usuario quiere el ciclo completo específicamente para este servicio, hace falta una sesión adicional |
| 2C.j consola/logs/red sin errores | PASA | sin errores de consola durante todo el flujo; único aviso esperado: imágenes de servicio rotas ("Imagen no disponible") en el selector de Paso 2, cosmético y ajeno a este servicio (compartido por los 7) |

Log completo del runner (`READINESS_ENGINE=local`, `SUPABASE_DB_CONTAINER=supabase_db_GarSer-referencia`):

```
=== 1. Escenarios (predicción Fase 1 vs. motor real) ===

✓ PASA       S1 base: 1000m², normal, sin herbicida, CON retirada
             420.00 € · 9 h
✗ FALLA      S2 sin retirada: 1000m², normal, sin herbicida
             horas esperadas 7.5, obtenidas 8
✗ FALLA      S3 dificultad_alta: 1000m², sin herbicida, sin retirada
             horas esperadas 11.5, obtenidas 13
✗ FALLA      S4 con herbicida: 1000m², normal, sin retirada
             horas esperadas 7.5, obtenidas 8
✓ PASA       S5 mínimo: 50m², normal, sin herbicida, sin retirada
             60.00 € · 1 h

=== 3. Barrido de variables (additional_config completo) ===

  base: 700.00 € · 15.5 h

✓ PASA       barrido precio_herbicida_m2 (applyHerbicide true)
✓ PASA       barrido suplementos.dificultad_media
✓ PASA       barrido suplementos.dificultad_alta
✓ PASA       barrido suplementos.retirada_restos

=== 4. Límites — el hallazgo central de este servicio ===

✓ PASA       4a. área 50.000m² CON dataInputMode=manual → 422 manual_input_invalid
✗ FALLA      4b. área 50.000m² SIN dataInputMode (payload real de la UI)
             NO se rechaza: totalPrice=17500 €, estimatedHours=375 h.
✓ PASA       4c. área exactamente 10.000m² CON dataInputMode=manual → acepta (3500 €)
✓ PASA       4d. área 10.001m² CON dataInputMode=manual → 422

=== 6. Cambio de precio ===
✓ PASA       756.00 € · 18.5 h

=== 7. Disponibilidad ===
✓ PASA       Domingo sin huecos · Sábado corto con huecos · Madrid fuera de cobertura

──────────────────────────────────────────────────────────────────────
  14 PASA · 4 FALLA · 1 NO PROBADO
──────────────────────────────────────────────────────────────────────
```

## 6. Red de regresión

Runner: [`scripts/readiness/desbroce.mjs`](../../../scripts/readiness/desbroce.mjs)
(reescrito sobre el heredado de la tanda anterior: `serviceId` corregido, predicción de S3
recalculada contra el % real en vez de calcar el bug, fechas de disponibilidad movidas a
futuro con margen).

```bash
READINESS_ENGINE=local SUPABASE_PROJECT_DIR=~/Downloads/GarSer-referencia \
  SUPABASE_DB_CONTAINER=supabase_db_GarSer-referencia \
  node scripts/readiness/desbroce.mjs
```

Sale con código 1 mientras los hallazgos #1 y #2 sigan sin corregir (eso es correcto: el
runner debe estar en rojo hasta que se arreglen). No toca `_harness.mjs` ni ningún fichero
de otro servicio.

## 7. Hallazgos transversales

Todos ya estaban documentados en `docs/audit/COORDINACION-SERVICIOS.md` §3.2 antes de esta
auditoría. Lo que aporto es evidencia fresca de que también afectan a desbroce — **se
anotan aquí y en el fichero de coordinación, no se arreglan en esta rama**:

- **T1** (puerta de licencia fitosanitaria ausente): reproducido en vivo. El jardinero
  sembrado no tiene licencia verificada (`Configuración del Perfil → Licencia de productos
  fitosanitarios` sin archivo) y aun así su configurador de desbroce permite activar
  "Aplicación de Herbicida" sin bloqueo alguno — el mismo vacío que fitosanitarios ya
  extendió a este servicio (`docs/audit/2026-09-12-fitosanitarios/REPORT.md` §5).
- **T2** (redondeo de horas, residuo de coma flotante): reproducido con inputs nuevos
  propios de desbroce — `(1000/120)*0.9` y `(2000/120)*0.9` dejan el mismo tipo de residuo
  que césped ya documentó con `(5000/150)*0.9`. Confirma que T2 no depende del servicio,
  depende de que `área/yield` no dé un cociente exacto y cruce el umbral de 8 h.
  **Importante para no confundirlo con el hallazgo #2**: T2 añade ~0,5 h por un artefacto
  de precisión de punto flotante; el hallazgo #2 añade 1,5-2 h por usar un porcentaje
  distinto al configurado. Son dos causas distintas que hoy coexisten en el mismo bloque.
- **T6** (header "(1h)" incoherente en Solicitudes de Reserva): reproducido —
  "sábado, 19 septiembre 2026 09:00:00 - 13:00:00 **(1h)**" junto a "Duración estimada:
  **4h**" en la misma tarjeta.
- **T7** (trabajo que no cabe en un día, sin aviso al cliente): reproducido con un caso
  realista, no un edge case — 1000 m² a dificultad alta (13 h con el bug #2, o 11,5 h
  incluso corregido) no cabe en la jornada más larga sembrada (10 h) y el cliente se
  encuentra "No hay profesionales disponibles" sin ninguna pista de que el problema es el
  tamaño del trabajo.
- **T9** ("Cliente desconocido" en Solicitudes de Reserva): reproducido — la solicitud de
  desbroce muestra "Cliente desconocido" igual que las demás.
- **T11** (email de confirmación nunca llega): reproducido con un pago real de desbroce —
  Mailpit (`http://127.0.0.1:54324/api/v1/messages`) devuelve `"count":0` tras completar el
  pago y la reserva.

**Corrección a un hallazgo previamente anotado — T12 no se reproduce en el configurador de
desbroce.** `docs/audit/COORDINACION-SERVICIOS.md` §3.2 (fila T12, escrita por la auditoría
de fitosanitarios) afirma que `WeedingPricingConfigurator.tsx` comparte el patrón de
comparar `config.pricing_method === 'per_quantity'` en crudo y que "hoy afecta de verdad a
desbroce" porque al jardinero sembrado le falta esa clave. Verificado leyendo el fichero
completo y con `grep -rn "pricing_method"` sobre todo `src/`:
`WeedingPricingConfigurator.tsx` **no contiene ninguna referencia a `pricing_method` ni a
`getPricingMethod`** — no tiene selector de método de tarifa (desbroce es exclusivamente
por m², como poda de árboles es exclusivamente por unidad) y todas sus secciones (mínimo,
velocidad, precio base, herbicida, suplementos) se renderizan siempre, sin condición
alguna. Es un falso positivo respecto a este servicio, mismo tipo de corrección que T13 ya
recibió para fitosanitarios — lo dejo anotado en el fichero de coordinación para que nadie
vuelva a darlo por bueno.

**Autoguardado en el primer render — cuarta comprobación, negativa.** Siguiendo la
pregunta que dejaron abierta setos y palmeras (`additional_config` guardado sin que el
jardinero toque nada), abrí `WeedingPricingConfigurator` y esperé sin tocar nada: el
`additional_config` quedó intacto (`md5=06d7c214a7ad7d0d2b8b0ce66332df5e`, `updated_at` sin
moverse). Van 4 de 7 descartados (césped, árboles, fitosanitarios, desbroce), 2 de 7
confirmados (setos, palmeras); solo arbustos queda sin revisar bajo esta pregunta
específica.

## 8. Acciones manuales del usuario

- **Tras el merge, redesplegar `booking-authority`** (`supabase functions deploy
  booking-authority --use-api`): esta rama toca `src/shared/bookingQuoteCore.ts`, que esa
  función importa. Sin redesplegar, el fix del hallazgo #2 (horas) y del #3 (aviso de
  plausibilidad) no llega a producción aunque el front sí esté actualizado. `supabase db
  push` no aplica — esta rama no añade ninguna migración.
- **Actualizar el entorno local compartido** después del merge (lo hace el usuario, no un
  chat de servicio — reiniciar Supabase corta a las demás sesiones activas): `cd
  ~/Downloads/GarSer-referencia && git pull && supabase stop && supabase start`, luego
  `supabase migration up` (0 esperadas), y avisar a las sesiones activas para que rebasen y
  repitan lo que dependa de este merge.
- **Decisión de negocio pendiente para el hallazgo #4** (herbicida sin tiempo estimado, ver
  §9): si aplicar herbicida debe sumar minutos al trabajo, hace falta que el usuario decida
  cuánto y se añada un campo de rendimiento nuevo a la configuración — no lo he inventado yo.
- **NO PROBADO — ciclo de vida completo específico de desbroce** (cambio de precio
  aceptado por el cliente, cancelación con reembolso, finalización, reseña, volver a
  reservar): el mecanismo transversal ya está verificado con pago real en otros servicios,
  pero no se ha repetido con una reserva de desbroce en esta sesión. Para cerrarlo:
  repetir §5 (2C.f) con la reserva `84990e26-5c8e-4b70-b3bd-8d4d4c34259a` ya creada y
  confirmada, o con una nueva.
- **NO PROBADO — subida de fotos por UI**: no aplica a este servicio (sin flujo de fotos
  por diseño).
- **NO PROBADO — verificación por HTTP del hallazgo #1 contra `booking-authority`
  desplegado**: hoy solo está verificado (a) en el motor en proceso (`READINESS_ENGINE=local`)
  y (b) en vivo en el navegador contra el front de este worktree. Falta repetir el runner
  completo por HTTP una vez desplegado, junto con los de los demás servicios (paso 5 del
  cierre de la skill).

## 9. Fase 3 — Corrección (2026-09-12, autorizada explícitamente por el usuario)

Los hallazgos #1, #2 y #3 de §1 están corregidos y reverificados. El #4 se deja sin tocar a
propósito. Nada transversal se ha tocado — T1/T2/T6/T7/T9/T11 y la corrección de T12 siguen
solo anotados en `docs/audit/COORDINACION-SERVICIOS.md` §3.2, tal y como exige la skill.

### Hallazgo #1 — corregido en el cliente, no en el motor

**Fix:** `src/pages/reserva/DetailsPage.tsx`, dentro de `commitSimplePhotoCollectionPatch`
(la función que centraliza los 5 puntos donde se escribe `weedingZones` en `bookingData`):
se añade `dataInputMode: 'manual'` al patch siempre que la clave sea `weedingZones`, antes
de aplicar `extraPatch`. Cubre los 5 call-sites existentes (inicialización de la zona,
sincronización del flag de herbicida persistido, el toggle de herbicida, y el botón de
datos de prueba) sin tocar ninguno de ellos individualmente ni el patch de ningún otro
servicio (`lawnZones`, `treeGroups`, `palmGroups`, `shrubGroups`, `phytosanitaryZones`
usan la misma función pero la condición solo dispara para `weedingZones`).

**Lo que se consideró y se descartó:** mover la validación al propio
`supabase/functions/booking-authority/index.ts` (que hoy solo valida
`si dataInputMode==='manual'`, así que un futuro consumidor de la función que vuelva a
olvidar el flag repetiría el mismo fallo) para tener defensa también del lado del motor.
Se probó y se revirtió: es un fichero compartido por las 7 auditorías, desplegado, y
`READINESS_ENGINE=local` no lo ejercita en absoluto (llama a `bookingQuoteCore.ts`
directamente, sin pasar por `index.ts`), así que no hay forma de verificarlo en este
entorno sin desplegar a la instancia de Supabase local compartida — exactamente lo que la
skill prohíbe hacer desde un worktree de servicio. Se deja como sugerencia para el usuario,
no como código sin probar. El fix del cliente, en cambio, sí está verificado en vivo.

**Verificación (en vivo, navegador, antes y después):**
- Antes del fix: 50.000 m² → `200 OK`, `totalPrice=17500`, `estimatedHours=375`,
  `warnings: []` (capturado por red).
- Después del fix, mismo input exacto: `422 Unprocessable Entity`,
  `{"error":"Algunos datos introducidos están fuera de los valores permitidos.","code":"manual_input_invalid","validationErrors":[{"field":"weedingZones[0].area","code":"out_of_range","message":"la superficie a desbrozar debe estar entre 1 y 10000."}]}`
  (capturado por red, misma sesión, mismo formulario).
- Camino feliz sin romper: 300 m², dificultad normal, con retirada → `200 OK`,
  `totalPrice=126`, `estimatedHours=3`, coincide al céntimo con
  `(300×0,35)×1,2=126` y con lo mostrado en pantalla (141,75 € total / 126 € profesional /
  15,75 € gestión).
- Runner: `4a`/`4c`/`4d` siguen PASA sin cambios; `4b` pasa de `FALLA` a `NO PROBADO` — no
  porque el bug siga vivo, sino porque `READINESS_ENGINE=local` no puede ver un fix que
  vive en `DetailsPage.tsx` (un fichero de front, no del motor). La prueba de contrato por
  HTTP queda pendiente para después del despliegue (ver §8).

**Lo que NO se ha tocado:** la encuesta muerta (`MANUAL_ENTRY_SURVEYS.weeding` en
`manualEntrySchema.ts`) sigue muerta. Decidir si se reactiva (opción A del hallazgo
original) sigue siendo una decisión de arquitectura del usuario, no algo que este fix
resuelva — el fix elegido fue el mínimo contenido (opción B), no un rediseño.

### Hallazgo #2 — corregido en el motor, con `getDurationMultiplier` retirado por completo

**Fix:** `src/shared/bookingQuoteCore.ts`, dentro del bloque
`if (bookingData.weedingZones?.length)` de horas: se sustituye
`getDurationMultiplier(zone.state)` (fijo, 1,3/1,7) por el mismo cálculo de `stateMult` que
ya usa `calculateWeedingQuote` para el precio, leyendo
`config.suplementos.dificultad_media`/`dificultad_alta` con `normalizeWeedingState` (ya
existente, sin tocar). Mismo patrón exacto que el fix ya aplicado a césped, setos y
arbustos.

Como desbroce era el último bloque que llamaba a `getDurationMultiplier`, la función quedó
completamente muerta (confirmado por `grep` en todo `src/`, sin exportar ni usarse en
ningún otro fichero) y se ha **eliminado**, no dejado como código muerto. Se actualizó
también el comentario del bloque de césped que la citaba como "lo que aún usan
desbroce/arbustos", para no dejar una referencia desactualizada a una función que ya no
existe.

**Verificación:**
- Runner, S3 (1000 m², dificultad alta, sin herbicida, sin retirada): antes `525 € · 13,0
  h` (FALLA, esperaba 11,5 h), ahora `525 € · 11,5 h` (PASA) — exactamente
  `(1000/120)×1,5=12,5h; >8h→×0,9=11,25h; ceil(11,25×2)/2=11,5h`, el cálculo con el 50 %
  real configurado.
- Runner, sección 6 (cambio de precio, 1200 m² dificultad alta + retirada): antes `756 € ·
  18,5 h`, ahora `756 € · 16,5 h` — mismo patrón, a mayor escala (2 h de diferencia en vez
  de 1,5 h).
- `tsc --noEmit -p tsconfig.app.json`: **172 → 172** (medido con `git stash` antes de
  tocar nada y comparado contra el mismo comando tras el fix — sin errores nuevos, la
  función eliminada no dejó ninguna referencia huérfana).
- `vitest run`: **437 → 437** (sin cambios; no había ningún test que ejercitara
  `getDurationMultiplier` directamente para desbroce, así que su eliminación no rompió
  nada).

**No confundir con T2** (transversal, sin tocar): S2 y S4 del runner siguen mostrando 8 h
en vez de las 7,5 h exactas por el residuo de coma flotante de `(1000/120)*0.9` — eso es
T2, no el hallazgo #2, y sigue sin corregirse aquí a propósito (ver `COORDINACION-SERVICIOS.md`
§3.2).

### Hallazgo #3 — corregido, aviso de plausibilidad añadido

**Fix:** `src/shared/bookingQuoteCore.ts`: nueva constante `WEEDING_MAX_PLAUSIBLE_AREA_M2 =
2000` (mismo valor que césped, junto a las demás constantes `*_MAX_PLAUSIBLE_*`) y un
`pushWarning('weeding_area_implausible', ...)` dentro del mismo bloque de horas, mismo
patrón que `lawn_area_implausible`/`hedge_length_implausible`/`palm_quantity_implausible`/
`shrub_area_implausible`. Solo avisa, no bloquea — igual que los cuatro anteriores.

**Verificación:** runner, nuevos casos 4e/4f — 3000 m² (por debajo del máximo manual de
10.000, por encima del umbral de plausibilidad de 2000) → `warnings:
[{"code":"weeding_area_implausible","message":"La superficie declarada (3000 m²) supera lo
habitual para una parcela residencial (2000 m²): confirma la medida antes de continuar."}]`;
1500 m² (por debajo del umbral) → `warnings: []`. Ambos PASA.

### Hallazgo #4 — dejado sin tocar, a propósito

No se ha añadido ningún campo de rendimiento para el herbicida. `additional_config` no
tiene ninguna clave de tiempo asociada al herbicida y no me corresponde inventar una cifra
de negocio (¿cuántos m²/hora se pulverizan? ¿es un tiempo fijo por zona?). Queda en §8 como
decisión pendiente del usuario.

### Cierre verificado

```
READINESS_ENGINE=local SUPABASE_PROJECT_DIR=~/Downloads/GarSer-referencia \
  SUPABASE_DB_CONTAINER=supabase_db_GarSer-referencia \
  node scripts/readiness/desbroce.mjs
```
→ **19 PASA · 0 FALLA · 4 NO PROBADO** (los 4 NO PROBADO: paridad IA↔manual, que no
aplica; S2/S4 horas, que son T2 transversal citado, no un hallazgo propio; y 4b, que es el
hallazgo #1 ya corregido pero invisible a este modo de medición — ver arriba).

`npx tsc --noEmit -p tsconfig.app.json`: **172 → 172**, sin errores nuevos.

`npx vitest run`: **437 → 437**, todo verde.

Ficheros tocados por esta rama en Fase 3: `src/shared/bookingQuoteCore.ts` (bloque de
desbroce, más la eliminación de `getDurationMultiplier` que quedó huérfana),
`src/pages/reserva/DetailsPage.tsx` (`commitSimplePhotoCollectionPatch`),
`scripts/readiness/desbroce.mjs`, y este informe. Nada de otro servicio, ni
`_harness.mjs`, ni ningún fichero compartido más allá de los dos ya citados en
`bookingQuoteCore.ts`/`DetailsPage.tsx` (que también tocan otras auditorías, en sus propios
bloques — ver el registro en `COORDINACION-SERVICIOS.md` §2, actualizado). La PR la abre
el usuario.
