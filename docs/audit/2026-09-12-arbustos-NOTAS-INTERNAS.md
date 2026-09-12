# Notas internas — auditoría arbustos (borrador de trabajo, no es el informe final)

## Entorno
- Worktree: /Users/javier/Downloads/auditorias/arbustos, rama auditoria/arbustos, puerto 5185.
- Rebasada sobre origin/main (incluye b6356c9, fitosanitarios GO).
- serviceId real (verificado por SQL): 649bcd71-514e-4438-ad64-1136172de98a
  (el de references/servicios.md, 40798630-..., es FANTASMA — coincide con lo ya
  documentado en COORDINACION-SERVICIOS.md, ahora confirmado por mí).
- Config sembrada del jardinero (verificada por SQL, gardener_service_prices):
  prices_per_m2: {pequeñas:4.5, medianas:6.5, grandes:9.0}
  yield_m2_per_hour: {pequeñas:12, medianas:8, grandes:5}
  condition_surcharges: {media:20, alta:50}
  waste_removal.percentage: 15
  minimum_price: 45
  pricing_method: per_quantity (precioPorHora:30, no usado)
- AVISO ENTORNO: ~/Downloads/GarSer-referencia (stack compartido) iba 1 commit por detrás
  de origin/main (justo b6356c9, fitosanitarios, que reescribe bookingQuoteCore.ts).
  Migraciones al día (sin pendientes). Esto afecta a 2B/2C (HTTP real) pero NO a 2A
  (READINESS_ENGINE=local usa mi propio código). Avisado al usuario al empezar.

## Hallazgos Fase 1 (a confirmar/matizar en Fase 2)

### #1 — BLOQUEANTE: el estado de las plantas detectado por IA nunca llega a la reserva (camino global)
`src/pages/reserva/DetailsPage.tsx:2385-2411` (dentro de `runAIAnalysis`, el manejador
bulk de `res.tareas`): el `newShrubGroups.push({...})` construye size correctamente pero
NUNCA lee `t.estado_plantas` ni asigna `state`/`stateProposedByAI` — a diferencia del
bloque gemelo de césped (`:2265-2268`, sí asigna `state`) y de setos (`:2302-2312`, ídem).
Consecuencia: toda reserva de arbustos analizada por este camino queda con
`group.state === undefined` → el motor lo trata como 'normal' → NUNCA se aplica el
recargo de estado (+20%/+50%) ni se añade el tiempo correspondiente, aunque Gemini SÍ
pide y devuelve `estado_plantas` (`ai-pricing-estimator/new_prompts.ts:466,500`,
`index.ts:1475` lo normaliza).
Existe un segundo camino, CORRECTO: `analyzeShrubGroup` (`DetailsPage.tsx:4084-4145`) usa
`adaptShrubAnalysisResult` (`detailsPageAdapters.ts:642-690`), que SÍ lee
`estado_plantas`/`shrubMetrics.estado_plantas` y fija `state` + `stateProposedByAI`
correctamente. Este es el camino del botón "Analizar esta zona" dentro de cada grupo
(`DetailsPage.tsx:5851`).
El botón GLOBAL "Analizar" (`serviceFlags.showsGlobalAnalyzeButton`,
`detailsPagePresentation.ts:52`: `!isLawn && !isHedge && !isWeeding` → true para arbustos)
sí se muestra para arbustos y dispara `runAIAnalysis()` (línea 6586), el camino BUGGY.
Ambos botones coexisten en la misma pantalla. Cuál se usa en la práctica depende de si el
cliente sube fotos "sueltas" (pool general → botón global) o crea un grupo primero y le
sube fotos directamente (→ "Analizar esta zona").
NO PROBADO end-to-end con fotos reales (el panel Browser no sube ficheros), pero la
existencia y el cableado de ambos botones SÍ están confirmados leyendo el código y
verificados visualmente en el DOM (pendiente captura en Fase 2C).
Impacto: infracobro silencioso al cliente + infra-agendado de tiempo al jardinero para
CUALQUIER reserva de arbustos por fotos que pase por el botón global con plantas
descuidadas/muy descuidadas. Viola paridad IA↔manual (dimensión 2): el mismo macizo
descrito a mano cuesta un 20-50% más que por fotos.

### #2 — ALTA: `condition_surcharges` de arbustos no es configurable por el jardinero
`src/components/gardener/ShrubPricingConfigurator.tsx` no tiene NINGÚN campo para
`condition_surcharges.media/alta` (confirmado leyendo el fichero completo, 413 líneas).
Lawn/Hedge/Palm SÍ lo exponen (`LawnPricingConfigurator.tsx:333,347`,
`HedgePricingConfigurator.tsx:533,551`, `PalmPricingConfigurator.tsx:658,685`).
El tipo `ShrubPricingConfig` (`src/types/index.ts:305-323`) ni siquiera declara el campo.
El motor cae al hardcoded `DEFAULT_SHRUB_SURCHARGES = {media:20, alta:50}`
(`bookingQuoteCore.ts:237`) cuando falta. Hoy coincide con lo sembrado en BD (probablemente
puesto directamente por SQL, no por la UI) — pero ningún jardinero, nuevo o existente,
puede ver ni cambiar este recargo desde su panel.
Verificado: el `useMemo` que deriva `config` desde `value` preserva `condition_surcharges`
vía `...value` (no lo pisa), así que si YA existe en BD no se borra al guardar otro campo
— pero tampoco se puede editar ni ver.

### #3 — MEDIA: horas de arbustos usan multiplicador fijo, no el % configurado (patrón ya conocido)
`bookingQuoteCore.ts:1444` usa `getDurationMultiplier(group.state)` (fijo: descuidado=+30%,
muy descuidado=+70%) para las HORAS, mientras el bloque de PRECIO (`:445-446` y `:1583-1584`)
usa correctamente `resolveSurchargePercent(surcharges.media/alta, ...)` (config real hoy:
+20%/+50%). Ya anotado como patrón conocido sin corregir en COORDINACION-SERVICIOS.md
(césped y setos ya lo arreglaron en su propio bloque). Cuantificado en Fase 2 con el
Escenario 3 del runner: con 20 m² medianas descuidado, precio correcto = 156€ (+20% sobre
130€ base) pero horas actuales = 3.5h frente a las 3.0h que corresponderían si usaran el
mismo 20% que el precio — 0.5h (16.7%) de agenda de más por cada reserva en estado
"descuidado", y proporcionalmente más en "muy descuidado".

### #4 — BAJA/MEDIA: sin aviso de plausibilidad de superficie para arbustos
No existe ningún `shrub_area_implausible` en `bookingQuoteCore.ts` (sí existen los
equivalentes de césped/setos/palmeras/fitosanitarios). El prompt de Gemini
(`new_prompts.ts:469`) considera "ambiguo" un macizo residencial >500 m², pero
`MANUAL_RANGES.shrub.superficie_m2.max` (`manualEntrySchema.ts:360`) permite hasta 2000 m²
sin ningún aviso — asimetría 4x entre lo que la IA trata como sospechoso y lo que el
manual acepta sin fricción, y ningún aviso del motor en ninguno de los dos caminos.
(El runner heredado de la tanda anterior asumía que esto ya se había arreglado a 500 —
FALSO en origin/main: sigue en 2000. No fiarse de ese runner.)

### #5 — BAJA: desglose (breakdown) puede no coincidir con el total con 2+ grupos
`buildShrubBreakdown` (`:449`) redondea CADA línea hacia arriba (`Math.ceil` por línea),
mientras `totalPrice` real (`:1587` + `applyMinimumPrice`) redondea la SUMA una sola vez.
Con 2+ `shrubGroups` de áreas no enteras, la suma de líneas mostradas puede superar lo
realmente cobrado, sin línea de ajuste (el código solo añade ajuste cuando
`totalPrice > currentBreakdownTotal`, no al revés). Alcance: el wizard manual es
`repeatable:false` (1 solo grupo), pero el flujo de fotos permite `addShrubGroup()`
varias veces, así que SÍ es alcanzable.

## Verificado correcto (no hallazgo)
- Autoguardado en el primer render (patrón de setos/palmeras): NO se reproduce en
  ShrubPricingConfigurator — `value` e `initialConfig` provienen del mismo
  `row.additional_config` crudo (`ProfileSettings.tsx:411`) y el `useMemo` del
  configurador no añade claves derivadas nuevas (solo coerción numérica). Arbustos queda
  DESCARTADO para este patrón (eran 2/7 confirmados: setos, palmeras; ahora 4/7
  descartados: césped, árboles, fitosanitarios, arbustos).
- `pricing_method` está explícito como `per_quantity` en la config sembrada → T12 (uso
  crudo de `pricing_method` en vez de `getPricingMethod()`) NO afecta hoy a arbustos
  (si faltara la clave, sí — mismo patrón que fitosanitarios/desbroce, pero hoy no falta).
- `waste_removal` SÍ está correctamente wireado en ambos bloques (precio y horas) con el
  mismo % — el mismatch es SOLO en `condition_surcharges`, no en `waste_removal`.
- `resolveSurchargePercent` respeta el 0 explícito correctamente en ambos bloques de
  arbustos (precio y horas ya usan la función, cuando la usan).
- `wasteRemoval` per-group vs root: `withWaste()` en manualEntryBuilders sobreescribe
  correctamente el placeholder `true` de `buildShrubGroups` con el valor real resuelto.
- Manual entry SÍ captura estado correctamente vía `adaptShrubAnalysisResult`
  (manualEntryBuilders.ts:282) — el manual NO tiene el bug de #1.

## Pendiente de verificar en Fase 2
- Ejecutar runner reescrito (2A, READINESS_ENGINE=local) con serviceId correcto.
- Confirmar en navegador: ausencia de campo condition_surcharges en el configurador (#2).
- Confirmar en navegador: coexistencia de botón global "Analizar" y "Analizar esta zona"
  para arbustos, y cuál es el flujo por defecto que ve un cliente nuevo (#1).
- Ciclo de vida: pago, cambio de precio, cancelación — usar hallazgos transversales ya
  documentados (T1/T2/T4/T5/T6/T7/T8/T9/T10/T11/T12) en vez de re-descubrirlos; solo
  reproducir lo específico de arbustos si aparece algo nuevo.
- Disponibilidad: domingo sin huecos, Marbella dentro, Madrid fuera.
