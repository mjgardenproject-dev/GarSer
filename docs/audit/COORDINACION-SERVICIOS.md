# Coordinación entre las auditorías de servicio

> Siete auditorías a la vez, una por servicio, cada una en su rama. Este fichero existe por
> una razón concreta: **el motor de precios de los siete servicios vive en un solo
> fichero**, así que aunque cada auditoría toque solo su servicio, todas editan las mismas
> líneas.
>
> Dos secciones y nada más: el registro de qué toca cada rama, y los hallazgos que afectan
> a más de un servicio.

---

## 1. Las dos reglas

**Regla 1 — No se toca el servicio de otro.** Ni su configurador, ni su bloque del motor,
ni su encuesta manual, ni su runner.

**Regla 2 — Un hallazgo que afecta a más de un servicio se anota aquí, no se arregla.** Va
a §3 y espera a la ronda transversal final. Arreglarlo en la rama de un servicio es lo que
produce conflictos en el motor de precios, que es el único sitio donde un conflicto mal
resuelto cuesta dinero.

Cómo distinguirlos, en una frase: **si el arreglo sirve igual para un servicio que no estás
auditando, es transversal.**

---

## 2. Registro de ficheros compartidos

Cada auditoría añade su fila al terminar. Si dos ramas aparecen en la misma, hay que mirarla
antes de integrar nada.

| Fichero compartido | Ramas que lo tocan | Qué le hace cada una |
|---|---|---|
| `scripts/readiness/cesped.mjs` | `auditoria/cesped` | Reescrito: `serviceId` corregido (el de la skill estaba obsoleto), predicciones recalculadas contra el motor real. T2 y T7 marcados `untested(...)` (no FALLA) citando su número aquí; 2A.3b pasó de documentar el hallazgo #1 a comprobar que está corregido. No toca `_harness.mjs`. |
| `src/shared/bookingQuoteCore.ts` | `auditoria/cesped` | **Fase 3 (2026-09-11/12), las dos veces dentro del bloque `if (bookingData.lawnZones?.length)` de horas:** (1) añadida `LAWN_MAX_PLAUSIBLE_AREA_M2 = 2000` y un `pushWarning('lawn_area_implausible', …)` por zona que la supere — arregla el hallazgo #2. (2) sustituida la llamada a `getDurationMultiplier` por el mismo cálculo de `stateMult` que ya usaba el bloque de precio (mismos fallbacks 20 %/50 %) — arregla el hallazgo #1, revisado y autorizado por el usuario en una segunda vuelta tras rechazar el primer enfoque. **No toca** `getDurationMultiplier` en sí (sigue viva para setos `:1275`, desbroce `:1302`, arbustos `:1312`) ni ningún bloque de otro servicio: el fix quedó contenido en el bloque de césped sin tocar código compartido, así que **no era transversal** — la fila T3 que lo documentaba como tal se retiró de §3.2 (ver nota de abajo). |
| `scripts/readiness/arboles.mjs` | `auditoria/arboles` | Reescrito dos veces (2026-09-11): primero por `serviceId` fantasma heredado (`f1bee417-…`, no existe en este entorno; el correcto es `feebd2eb-8347-435c-acda-10537b77e934`), después tras rebasar sobre `origin/main` para reflejar el fix de pago de la PR #18 ya integrado. 15/15 PASA con `READINESS_ENGINE=local` sobre el motor post-rebase (incluye el bloque de césped tocado arriba, que no afecta al bloque de árboles). No toca `_harness.mjs` ni ningún fichero de otro servicio. |
| `src/shared/manualEntry/manualEntrySchema.ts` | `auditoria/arboles` | **Fase 3 (2026-09-11):** añadida la entrada `tree: { quantity: { min: 1, max: 20 } }` a `MANUAL_RANGES` (arregla el hallazgo #1: el stepper "Cantidad de árboles idénticos" no tenía tope). Solo se añade una clave nueva al objeto — no se toca ninguna entrada de `lawn`/`hedge`/`palm`/`shrub`/`phytosanitary`/`weeding`. |
| `src/shared/manualEntry/manualEntryValidation.ts` | `auditoria/arboles` | **Fase 3 (2026-09-11):** dentro de `case 'tree':`, añadida una llamada a `pushRange` para `treeGroups[i].quantity` contra el nuevo `MANUAL_RANGES.tree.quantity` (con `?? 1` como default, mismo patrón que `hedge.faces_to_trim`, para no romper los grupos que no declaran `quantity`). Solo se toca el bloque `case 'tree':`; el resto de `case`s (lawn/hedge/palm/shrub/phytosanitary/weeding) sin cambios. |
| `src/pages/reserva/DetailsPage.tsx` | `auditoria/arboles` | **Fase 3 (2026-09-11):** en el bloque del stepper "Cantidad de árboles idénticos" (import de `MANUAL_RANGES` añadido a la lista ya existente desde `manualEntrySchema`), se añade `Math.min(MANUAL_RANGES.tree.quantity.max, …)` a los tres sitios que mutan `quantity` (botón `-`, `onChange`, botón `+`) y un aviso cuando se llega al tope. También se borra la línea `// import { TreePruningBooking } from '../../components/client/TreePruningBooking';` (código muerto, hallazgo #4). Ningún otro bloque de servicio tocado. |
| `src/shared/bookingQuoteCore.ts` | `auditoria/setos` | **Fase 3 (2026-09-11), las dos dentro del bloque `if (bookingData.hedgeZones?.length)` de horas (import de `HEDGE_MAX_PLAUSIBLE_LENGTH_M` añadido desde `../domain/hedgeBusinessRules.ts`, misma SSOT que ya usan `manualEntrySchema.ts` y `ai-pricing-estimator`):** (1) sustituida la llamada a `getDurationMultiplier` por el mismo `resolveSurchargePercent(config.condition_surcharges.media/alta, DEFAULT_HEDGE_SURCHARGES)` que ya usaba el bloque de precio — arregla el hallazgo #1, mismo patrón exacto que el fix de césped citado arriba. (2) añadido un `pushWarning('hedge_length_implausible', …)` por zona con `length > HEDGE_MAX_PLAUSIBLE_LENGTH_M` (200 ml) — arregla el hallazgo #3, mismo patrón que `lawn_area_implausible`. También se actualizó el comentario que dejó el fix de césped (línea ~1274) para quitar "setos" de la lista de servicios que aún usan el multiplicador fijo — **sigue siendo cierto para desbroce (`:1351`) y arbustos (`:1361`)**, sin tocar. **No toca** `getDurationMultiplier` en sí ni ningún bloque de otro servicio: contenido en el bloque de setos, **no es transversal** — ver la nota de evaluación transversal más abajo. Verificado: `READINESS_ENGINE=local` 35 PASA/0 FALLA/1 NO PROBADO, `tsc` 172→172 (sin nuevos), `vitest` 434/434. |

La Fase 2 de césped fue de solo lectura. En Fase 3 (autorizada por el usuario en dos vueltas,
2026-09-11 y 2026-09-12) se corrigieron los dos hallazgos propios de césped: #2 (aviso de
plausibilidad) y #1 (horas ligadas al mismo % que el precio, no al multiplicador fijo
compartido). El hallazgo #1 se documentó primero como T3 en §3.2 creyéndolo transversal; al
resultar que el fix cabía entero dentro del bloque de césped sin tocar `getDurationMultiplier`
ni otro servicio, **T3 se retiró** — no era del apartado que le correspondía. El número T3
queda sin usar a propósito, para no reescribir las referencias cruzadas de T2/T7 a los demás.
T2, T4, T5, T6 y T7 siguen **anotados, no arreglados**, a la espera de la ronda transversal.
Setos repitió el mismo patrón en Fase 3 (autorizada 2026-09-11): sus hallazgos #1 y #3, igual
que los de césped, cupieron enteros en el bloque propio sin tocar código compartido.

**Evaluación transversal de la auditoría de setos (pedida explícitamente por el usuario
2026-09-11):** de los 3 hallazgos de setos, **ninguno necesita arreglo central** — los tres se
corrigieron ya, cada uno contenido en un fichero que es "de setos" (el bloque `hedgeZones` de
`bookingQuoteCore.ts`, o `HedgePricingConfigurator.tsx`, que no comparte código con los otros
seis configuradores). Dos matices que sí conviene que las próximas auditorías tengan presentes,
sin ser hallazgos nuevos que haya que anotar aquí como T-algo:
- **El patrón del hallazgo #1 (horas con un multiplicador fijo en vez del % real del
  jardinero) sigue vivo, sin tocar, en desbroce (`bookingQuoteCore.ts:1351`) y arbustos
  (`:1361`)** — cada uno lo verá como un hallazgo propio de su Fase 1/2 cuando le toque, y el
  fix es el mismo que césped y setos ya aplicaron dos veces: sustituir `getDurationMultiplier`
  por el `stateMult` que ya calcula el bloque de precio de ese mismo servicio, sin tocar la
  función compartida. No hace falta pedir autorización para "lo transversal": es un fix
  contenido, como los dos anteriores.
- **El hallazgo #2 (autoguardado que dispara en el primer render y puede vaciar un campo mal
  inferido) es específico de `HedgePricingConfigurator.tsx`**, pero el mecanismo que lo permite
  — `useAutoSave` (`src/hooks/useAutoSave.ts`) compara el `config` derivado (siempre con la
  forma completa de `EMPTY_CONFIG`) contra el `initialConfig` crudo de BD con `deepEqual`
  estricto por número de claves, así que CUALQUIER configurador dispara un guardado al primer
  render si el jardinero tiene un campo legacy/ausente — no se ha comprobado si algún otro
  configurador (`LawnPricingConfigurator`, `PalmPricingConfigurator`, `TreePruningConfigurator`,
  `ShrubPricingConfigurator`, el de desbroce, el de fitosanitarios) tiene su propio
  `processConfigForSave`-equivalente con una condición similar que pueda vaciar un campo ya
  configurado. Esto **no se ha tocado ni verificado en ninguno de los otros seis** — queda como
  aviso para que cada auditoría revise su propio configurador con esta pregunta concreta: *"si
  lo abro sin tocar nada, ¿el primer autoguardado puede borrar algo que ya estaba bien puesto?"*

| `scripts/readiness/fitosanitarios.mjs` | `auditoria/fitosanitarios` | Reescrito (2026-09-12): el `serviceId` heredado `47a66caa-7671-45ec-b321-df6179249efd` era **fantasma** —todos los escenarios morían en `missing_provider_config` sin medir nada—, el real es `fc96088a-81f8-4efc-8908-b28a401ea556`; van 5 de 5 servicios con el mismo problema. Predicciones recalculadas a mano contra el `additional_config` leído por SQL. Añade barrido de las 26 tarifas de `detailed_pricing`, los tres modificadores (eco, combo 2, combo 3+), los mínimos por ámbito, la retirada y la paridad IA↔manual. Bloques de disponibilidad y puerta de licencia marcados `untested(...)` citando T1/T7, no FALLA. **Es el único fichero que esta rama modifica**: las fases 1 y 2 fueron de solo lectura, sin tocar `_harness.mjs`, el motor ni ningún fichero de otro servicio. |

| `src/shared/bookingQuoteCore.ts` | `auditoria/fitosanitarios` | **Fase 3 (2026-09-12), todo dentro del bloque fitosanitario:** (1) el camino manual y el de fotos pasan a compartir UNA tabla de precios — nuevas `derivePhytosanitaryMetricsFromZone` / `resolvePhytosanitaryMetrics`, que traducen una zona declarada a mano a las mismas métricas del análisis, y `calculatePhytosanitaryQuote` factura siempre desde `detailed_pricing`; **eliminadas** las estructuras derivadas (`superficies_plantas`, `setos`, `arboles`, `palmeras.tradicional`) del tipo y del normalizador, que eran la causa de cobrar la tarifa curativa a los preventivos y la de césped a las plantas. (2) `subtotal = base × nº de tratamientos` **sin** recargo de combo, por decisión de negocio del usuario. (3) nueva `phytosanitaryHoursFromMetrics`, usada por el bloque de horas, que ya cuenta `plantas_superficie_calculada_m2`. (4) mínimos por ámbito aplicados. (5) `PHYTOSANITARY_MAX_PLAUSIBLE_AREA = 5000` + `pushWarning('phytosanitary_area_implausible')`, mismo patrón que césped/setos/palmeras. (6) `detailedPricingFromLegacyConfig`, compatibilidad para profesionales con config v1 sin `detailed_pricing`. **No toca** `getDurationMultiplier`, `applyMinimumPrice`, el redondeo final de horas ni ningún bloque de otro servicio. Verificado: runner 74 PASA/0 FALLA, `tsc` 173→172, `vitest` 437/437. |
| `src/shared/manualEntry/manualEntrySchema.ts` | `auditoria/fitosanitarios` | **Fase 3 (2026-09-12):** añadidos tres juegos de opciones de porte (`PHYTOSANITARY_{TREE,PALM,PLANT}_SIZE_OPTIONS`) y, **solo dentro de la encuesta `phytosanitary`**, dos pasos nuevos (`size` y `endotherapy`) más el ajuste del paso `height` para que solo lo vean los setos. Añadidos también `MANUAL_SERVICE_KEYS_WITHOUT_WASTE_REMOVAL` y `serviceAsksForWasteRemoval()` (aditivo, exportaciones nuevas; ninguna encuesta ajena tocada). |
| `src/shared/manualEntry/manualEntryValidation.ts` | `auditoria/fitosanitarios` | **Fase 3 (2026-09-12):** nueva constante `PHYTO_SIZE_BANDS` y una llamada a `pushEnum` para `sizeBand` **dentro de `case 'phytosanitary':`**, opcional y solo para los ámbitos que tienen porte. Ningún otro `case` tocado. |
| `src/pages/reserva/manualEntryBuilders.ts` | `auditoria/fitosanitarios` | **Fase 3 (2026-09-12):** `buildPhytosanitaryZones` traslada `sizeBand` y `wantsEndotherapy` (esta última también en `type`, como en el flujo de fotos) y limita `aboveThreeMeters` a los setos. En `buildManualBookingPatch`, `wasteRemoval` pasa por `serviceAsksForWasteRemoval(serviceKey)`: los servicios que no la facturan la declaran `false` en vez de `true`. Ese último cambio es de la función compartida, pero **no altera el comportamiento de los otros seis** (todos siguen en la lista de los que sí preguntan). |
| `src/components/booking/manual/ManualEntryWizard.tsx` · `ManualEntrySummary.tsx` | `auditoria/fitosanitarios` | **Fase 3 (2026-09-12):** el wizard salta la fase `waste` y el resumen oculta su fila cuando `serviceAsksForWasteRemoval(survey.serviceKey)` es falso; el cálculo de progreso usa `extraPhases` en vez de un 3 fijo. Para los seis servicios que sí la preguntan, el comportamiento es idéntico al anterior. |
| `src/utils/phytosanitaryConfig.ts` | `auditoria/fitosanitarios` | **Fase 3 (2026-09-12):** `toPersistedPhytosanitaryConfig` dejaba `palmeras.endoterapia.precio_unico = maxCirugia`, que en cada guardado machacaba el precio de endoterapia del profesional con el de la cirugía más cara (65 → 160 €/tronco en el fixture, +146 %, en silencio). Ahora conserva el valor configurado y solo cae a la cirugía si nunca hubo uno; `endoterapia` se activa también cuando tiene precio propio. Fichero exclusivo de fitosanitarios. |

Los ficheros que suelen aparecer aquí, para que sepas cuáles vigilar:
`src/shared/bookingQuoteCore.ts`, `src/pages/reserva/ProvidersPage.tsx`,
`src/shared/manualEntry/manualEntrySchema.ts`, `src/pages/reserva/manualEntryBuilders.ts`,
`supabase/functions/booking-authority/index.ts`, `src/types/index.ts`,
`scripts/readiness/_harness.mjs`.

| `scripts/readiness/restore-fixture.sh` | `auditoria/setos` | Añadido el caso `setos` (`SERVICE_ID='7092ee0e-1779-45cf-bc2d-5235a757c618'`) al lado del ya existente `fitosanitarios`. Aditivo — un `case` más, no toca el de fitosanitarios. Hizo falta porque `HedgePricingConfigurator` reescribe `additional_config` al abrirse (ver hallazgo #2 en el informe de setos): tras verificarlo en vivo hubo que restaurar `pricing_matrix`/`yield_ml_per_hour` de la banda 4-6m antes de seguir midiendo. Fixture guardado en `scripts/readiness/fixtures/setos.config.json` (nuevo, propio de esta rama). No toca `_harness.mjs` ni el fixture de fitosanitarios. |
| `src/shared/bookingQuoteCore.ts` | `auditoria/palmeras` | **Fase 3 (2026-09-12), dentro del bloque `if (palmGroups.length)`:** añadida la constante `PALM_MAX_PLAUSIBLE_QUANTITY = 20` (junto a `LAWN_MAX_PLAUSIBLE_AREA_M2`) y un `pushWarning('palm_quantity_implausible', …)` por grupo que la supere — arregla el hallazgo #2 (auditoría de palmeras), mismo patrón que `lawn_area_implausible`/`hedge_length_implausible`. No toca ningún bloque de otro servicio ni `getDurationMultiplier`. |
| `src/pages/reserva/DetailsPage.tsx` | `auditoria/palmeras` | **Fase 3 (2026-09-12):** en `handlePalmQuantityChange`, el clamp pasa de `Math.max(1, …)` a `Math.min(MANUAL_RANGES.palm.quantity.max, Math.max(MANUAL_RANGES.palm.quantity.min, …))` — arregla el hallazgo #2 (el stepper "Cantidad de palmeras idénticas" del flujo de fotos no tenía techo, a diferencia de árboles y del propio manual de palmeras). También se añadió el aviso "Máximo N palmeras…" cuando se llega al tope, mismo patrón que el de árboles. Solo toca el bloque de palmeras; `MANUAL_RANGES` en sí no se modifica (solo se lee `MANUAL_RANGES.palm.quantity`, ya existente). |

| `src/shared/bookingQuoteCore.ts` | `auditoria/arbustos` | **Fase 3 (2026-09-12), todo dentro del bloque `if (bookingData.shrubGroups?.length)`:** (1) el bloque de horas sustituye `getDurationMultiplier` (fijo, 1.3/1.7) por el mismo `resolveSurchargePercent(condition_surcharges.media/alta, …)` que ya usaba el bloque de precio — arregla el hallazgo #3, mismo patrón exacto que césped/setos, que era justo lo que este fichero dejó anotado como pendiente para arbustos/desbroce. (2) nueva constante `SHRUB_MAX_PLAUSIBLE_AREA_M2 = 500` (junto a `LAWN_MAX_PLAUSIBLE_AREA_M2`/`PALM_MAX_PLAUSIBLE_QUANTITY`) y un `pushWarning('shrub_area_implausible', …)` — arregla el hallazgo #4. (3) `buildShrubBreakdown` reparte el redondeo entre líneas (todas menos la última al `Math.round`, la última absorbe el resto) en vez de redondear cada línea hacia arriba por separado — arregla el hallazgo #5 (coherencia desglose/total). **No toca** `getDurationMultiplier` en sí (sigue viva para desbroce, `:1479` en el momento de este fix) ni ningún bloque de otro servicio. Verificado: `READINESS_ENGINE=local` 18 PASA/0 FALLA/1 NO PROBADO, `tsc` 172→172 (sin nuevos), `vitest` 437/437. |
| `src/pages/reserva/DetailsPage.tsx` | `auditoria/arbustos` | **Fase 3 (2026-09-12):** dentro del `else if (normService.includes('poda de plantas'))` de `runAIAnalysis` (el manejador del botón global "Analizar"), se añade la lectura de `t.estado_plantas` y su mapeo a `state`/`stateProposedByAI` en el `shrubGroup` — arregla el hallazgo #1 (el estado que detecta la IA se perdía en silencio por este camino; el camino "Analizar esta zona" ya lo hacía bien vía `adaptShrubAnalysisResult`). Solo toca el bloque de arbustos de esa función; ningún otro `else if` de servicio tocado. |
| `src/utils/aiPricingEstimator.ts` | `auditoria/arbustos` | **Fase 3 (2026-09-12):** añadido `estado_plantas?: string | null;` a la interfaz `AITask` (sección "Shrubs") — el campo ya llegaba en el JSON real de `ai-pricing-estimator` pero no estaba tipado, y sin él `tsc` no dejaba compilar la lectura del hallazgo #1. Aditivo, un campo opcional más; ninguna otra sección de la interfaz tocada. |
| `src/types/index.ts` | `auditoria/arbustos` | **Fase 3 (2026-09-12):** añadido `condition_surcharges: { media: number; alta: number }` a `ShrubPricingConfig` (arregla el hallazgo #2, mismo shape que `HedgePricingConfig`). Solo se añade el campo; el resto de la interfaz y las demás interfaces de configuración de servicio no se tocan. |
| `src/components/gardener/ShrubPricingConfigurator.tsx` | `auditoria/arbustos` | **Fase 3 (2026-09-12):** nueva sección "Recargo por Estado" (Descuidadas/Muy descuidadas) — arregla el hallazgo #2 (el jardinero no tenía forma de ver ni configurar este recargo, a diferencia de césped/setos/palmeras). Fichero exclusivo de arbustos. |

| `scripts/readiness/desbroce.mjs` | `auditoria/desbroce` | **Fases 1-3 (2026-09-12):** reescrito sobre el heredado de la tanda anterior — `serviceId` fantasma `e2bb35b1-...` corregido al real `d946c65f-c588-4103-baca-0317667f04aa`; fechas de disponibilidad (§7) movidas a futuro con margen. Fase 3: predicciones de S3 y §6 actualizadas a los valores ya corregidos (11,5h/16,5h); S2/S4 separadas en precio (PASA) + horas marcadas `untested` citando T2 (transversal, no se toca); 4b pasó de `FALLA` a `untested` (el hallazgo real está corregido en el cliente, pero `READINESS_ENGINE=local` no lo ejercita porque el guard vive en `booking-authority/index.ts`, no en el motor); nuevos casos 4e/4f para el aviso de plausibilidad. **19 PASA/0 FALLA/4 NO PROBADO.** No toca `_harness.mjs` ni ningún fichero de otro servicio. Informe: `docs/audit/2026-09-12-desbroce/REPORT.md`. |
| `src/shared/bookingQuoteCore.ts` | `auditoria/desbroce` | **Fase 3, primera ronda (2026-09-12), todo dentro del bloque `if (bookingData.weedingZones?.length)` de horas:** (1) sustituida la llamada a `getDurationMultiplier` (fijo, 1.3/1.7) por el mismo `stateMult` derivado de `suplementos.dificultad_media/alta` que ya usaba `calculateWeedingQuote` para el precio — arregla el hallazgo #1 del informe (mismo patrón exacto que césped/setos/arbustos). Como desbroce era el último bloque que llamaba a `getDurationMultiplier`, la función quedó huérfana y se **eliminó** (confirmado sin usos en ningún otro fichero); se actualizó también el comentario del bloque de césped que la citaba como "aún usada por desbroce/arbustos". (2) nueva constante `WEEDING_MAX_PLAUSIBLE_AREA_M2 = 2000` (junto a `LAWN_MAX_PLAUSIBLE_AREA_M2`/etc.) y un `pushWarning('weeding_area_implausible', …)` — arregla el hallazgo #3. **Segunda ronda (2026-09-12), mismo bloque, a petición explícita del usuario:** el herbicida ahora suma el mismo % de tiempo que de precio — `weedingHerbicideMult = 1 + precio_herbicida_m2/precio_desbroce_m2`, aplicado a las horas solo cuando `zone.applyHerbicide` — arregla el hallazgo #4 (antes el herbicida solo sumaba precio). **No toca** ningún bloque de otro servicio. Verificado: `READINESS_ENGINE=local` 19 PASA/0 FALLA/3 NO PROBADO, `tsc` 171 (172→171, una menos que el baseline: se eliminó de paso un error de tipos preexistente al retirar el bloque que lo causaba en `DetailsPage.tsx`), `vitest` 437/437. |
| `src/pages/reserva/DetailsPage.tsx` | `auditoria/desbroce` | **Fase 3, primera ronda (2026-09-12):** dentro de `commitSimplePhotoCollectionPatch` (la función compartida que centraliza el patch de `lawnZones`/`treeGroups`/`palmGroups`/`shrubGroups`/`phytosanitaryZones`/`weedingZones`), se añade `dataInputMode: 'manual'` al patch cuando `key === 'weedingZones'` — arregla el hallazgo #1 (el editor ad-hoc de desbroce nunca fijaba este flag, así que el guard de rango de `MANUAL_RANGES.weeding.area` nunca se ejecutaba). Verificado en vivo: 50.000 m² pasó de `200 OK` (17.500€/375h) a `422 manual_input_invalid`. **Segunda ronda (2026-09-12), a petición explícita del usuario de "resucitar" el asistente genérico en vez de quedarse con el parche mínimo:** `isManualActive` pasa a `isManualOnlyActive || (manualChoiceAvailable && dataInputMode==='manual')`, con `isManualOnlyActive = isManualOnlyService(manualServiceKey)` — deliberadamente **sin depender de `manualFlowEnabled`** (el flag `VITE_ENABLE_MANUAL_BOOKING_INPUT` vale `false` por defecto en `.env.example`; para un servicio sin fotos ese flag no tiene nada que desactivar, y depender de él habría dejado a desbroce sin ninguna forma de reservar si estuviera apagado en producción). Retirado el editor ad-hoc completo (formulario, 3 `useEffect`, 5 handlers, el estado `weedingManualConfirmed` y su casilla de consentimiento, la validación de desbroce en `handleContinue` —ya inalcanzable, ese botón se oculta en modo manual—, y la rama de desbroce en "Datos de prueba"): 334 líneas netas menos. Ocultado también el enlace "Cambiar a fotos" del asistente para servicios manual-only (`showSwitchToPhotos={!isManualOnlyActive}`). **No cambia el comportamiento de los otros 6 servicios** (la condición solo activa para `manualServiceKey==='weeding'`, hoy el único `MANUAL_ONLY_SERVICE_KEYS`). Verificado en vivo con una reserva y pago reales de principio a fin: el asistente genérico aparece con sus 3 pasos + resumen + consentimiento, el precio coincide al céntimo (270€/300m²+dificultad alta+herbicida+retirada), `booking_manual_declarations` guarda el registro de auditoría que antes faltaba (`manual_declaration_id` poblado — antes desbroce era "el único de los siete sin prueba de lo que aceptó el cliente"), y el panel del jardinero ya muestra "Datos introducidos manualmente por el cliente · no verificados por IA" en vez de "Analizado por IA (fotos)". |
| `src/utils/weedingPersistence.ts` | `auditoria/desbroce` | **Fase 3, segunda ronda (2026-09-12): eliminado por completo.** Guardaba en `localStorage` el estado del toggle de herbicida del editor ad-hoc retirado arriba; sin ningún consumidor en el resto del repo tras la retirada (confirmado por `grep` sin resultados), así que se borra el fichero en vez de dejarlo como código muerto. No tenía test dedicado. |

**Migración nueva (no compartida):** `supabase/migrations/20260912100000_fix_palm_price_change_pricing_context_path.sql`
corrige la función `propose_booking_price_change` (hallazgo #4, sección 3.2 más abajo) — no
está en este registro porque ningún otro servicio la toca ni la necesita tocar, pero se
avisa aquí porque la función en sí es compartida por los 7 servicios: solo se sustituye el
contenido del bloque `IF v_is_palm_service THEN`, el resto de la función queda idéntico a
`20260803121000_fix_price_change_security_definer.sql`.

---

## 3. Hallazgos transversales — se anotan, no se arreglan

Antes de escribir uno, **búscalo aquí**: en la tanda anterior tres sesiones apuntaron el
mismo fallo de redondeo sin saberlo. Para cada uno: qué falla y dónde (`file:line`), cómo lo
reprodujiste, y a qué servicios crees que afecta.

### 3.1 · Pendientes de decisión del usuario

| # | Qué pasa |
|---|---|
| A | **No existe ningún reembolso, en ninguna parte.** El cliente paga la tarifa, el profesional rechaza, la reserva se cancela y el dinero no vuelve. Necesita política antes que código. **Corrección parcial (árboles, 2026-09-11):** para el caso "cliente cancela una reserva pendiente >24h antes, con el pago aún sin capturar" esto es falso — el botón "Cancelar reserva" existe en `/bookings` y funciona: probado con pago real (tarjeta de test), `bookings.status→cancelled`, `booking_payment_attempts` con el PaymentIntent que pasa a `status: 'canceled'` en Stripe (`amount_capturable=0`, nada cobrado). **Segunda corrección (palmeras, 2026-09-12) — cierra la pregunta que quedaba abierta:** cancelar una reserva **ya `confirmed` y con el pago ya `succeeded`** (capturado) SÍ dispara un reembolso real de Stripe. Probado con pago real de principio a fin: reserva de palmeras `fef54256-3fe6-41b3-a3a3-920651cbbbc7`, `bookings.status: confirmed→cancelled`, PaymentIntent `pi_3UEche2MwFyGXuB71qk1iJjA` (`succeeded`, `amount_received=2250`) → tras cancelar, `GET /v1/refunds?payment_intent=…` devuelve un reembolso `re_3UEche2MwFyGXuB71sXMGu88` por 2250 cts con `status: succeeded`. El mecanismo es compartido (no específico de palmeras) y ya no queda ningún camino de cancelación sin verificar en ninguno de los dos estados de pago. |
| B | **El cliente no puede cancelar su reserva** desde su área: solo tiene «Chat». **Falso, al menos en `/bookings` (árboles, 2026-09-11):** el botón "Cancelar reserva" está presente y funciona (ver A). No se ha comprobado si también existe en el dashboard de inicio. |

### 3.2 · Encontrados durante estas auditorías

| # | Servicio que lo encontró | Qué falla | Dónde | Afecta a |
|---|---|---|---|---|
| T1 | transversal (ronda previa a los servicios, 2026-09-09); **extendido y reproducido en vivo por desbroce (2026-09-12)** | **No se comprueba la licencia fitosanitaria en ninguna parte del backend.** Reproducido en vivo por desbroce: el jardinero sembrado no tiene licencia verificada (sin archivo subido en su perfil) y aun así `WeedingPricingConfigurator` le deja activar "Aplicación de Herbicida" sin ningún bloqueo — la promesa "Solo aparecerás en búsquedas... hasta que se verifique tu carnet" que ya se documentó rota para fitosanitarios se repite aquí. Original: Un trabajo con producto químico convencional (fitosanitarios no ecológicos, o desbroce con herbicida) es reservable con un jardinero **sin** carnet. `booking-authority` y `booking-payment` tienen 0 referencias a `has_phytosanitary_license`. `ProvidersPage` calcula `requiresCertifiedLicense` pero **nunca filtra la lista** por ese campo (solo cambia textos). Reproducido leyendo código; no probado E2E. | `src/pages/reserva/ProvidersPage.tsx:411-475` (no hay `.filter` por licencia) · `supabase/functions/booking-authority/index.ts` (0 refs) | fitosanitarios, desbroce. El arreglo correcto es un filtro en la capa compartida `booking-authority` / `ProvidersPage`, por eso se anota aquí. |
| T2 | transversal (2026-09-09); **reproducido por césped (2026-09-11) y por desbroce (2026-09-12)** | **✅ CERRADO (turno 2, 2026-09-14).** Redondeo de horas `if (totalHours > 8) totalHours *= 0.9;` + `Math.ceil(totalHours*2)/2`. La ronda transversal NO lo reprodujo barriendo `totalHours` en decimal (8,001–40,000 @ 0,001) — ese método no lo encuentra porque el residuo depende de la CADENA real de división/multiplicación, no del valor decimal final. Césped SÍ lo reprodujo con una entrada física real: `(5000/150)*0.9` en JS da `30.000000000000004` (residuo `3,55e-15`) en vez de `30` exacto; `Math.ceil(30.000000000000004*2)/2` sube a **30,5 h** en vez de 30,0 h. Verificado dos veces: motor en proceso (`READINESS_ENGINE=local`) y HTTP contra `booking-authority` con `{lawnZones:[{quantity:5000,state:'normal'}], wasteRemoval:false, dataInputMode:'manual'}` (serviceId césped `fe9d2d9e-3f62-4184-aa80-a3289d7c378a`) → mismo resultado los dos. Es un fallo confirmado, no solo una línea frágil: sobrecobra 0,5 h de agenda bloqueada cada vez que `quantity/yield` cae en una fracción binaria imprecisa que además cruza el umbral de 8 h. **Desbroce (2026-09-12) reprodujo el mismo patrón con inputs propios**, sin relación con césped: `(1000/120)*0.9` → 8h en vez de 7,5h exactas (dos casos, S2 y S4 del runner de desbroce) y `(2000/120)*0.9` → 15,5h en vez de 15,0h (base del barrido de variables). Confirma que T2 depende de la aritmética `área/yield`, no de un servicio concreto. **Cierre (turno 2, 2026-09-14):** `totalHours = Math.round(totalHours * 1e6) / 1e6` justo antes del `Math.ceil`, absorbiendo el ruido de coma flotante sin tocar la lógica de negocio. Los 3 casos documentados (30h, 7,5h, 15h) corregidos, verificados en Node. 7/7 runners en verde sin cambios — ninguno de sus fixtures cruza por casualidad estos umbrales, no hizo falta recalcular ninguno a mano. **Verificación en el navegador (a petición del usuario):** reservé en vivo 1250 m² césped normal sin retirada de restos (el caso reproducible más pequeño, `8,333h*0,9=7,500000000000001`) — la pantalla de selección de jardinero inicialmente siguió mostrando **8h** porque esa duración viene de `booking-authority`, desplegada desde `GarSer-referencia` y no desde este worktree (misma limitación que T1/T7). Repetí el mismo escenario exacto contra el motor en proceso (`READINESS_ENGINE=local`, la misma función sin pasar por HTTP): `estimatedHours: 7.5`, correcto. **Actualización (mismo día, a petición explícita del usuario): sincronizado `bookingQuoteCore.ts` a `GarSer-referencia` y reiniciado el stack local (`supabase stop && supabase start`, sin `db reset`, datos intactos).** Repetida la misma reserva en el navegador: la pantalla ya muestra **7,5h**, confirmado también en la respuesta HTTP cruda de `booking-authority` (`"estimatedHours":7.5`). **Probado de verdad por HTTP/navegador, no solo por el motor en proceso.** El stack local queda con T1+T2 desplegados, lo que también destraba la verificación HTTP de T7 y de la puerta de licencia de T1 en fases siguientes. `tsc` 171/171, `vitest` 453/453. Detalle completo: `docs/audit/2026-09-09-transversal/PLAN-IMPLEMENTACION-TURNO2.md`, Fase 4. Commit `ec9a7b7`. | `src/shared/bookingQuoteCore.ts:1551-1552` (línea movida por cambios acumulados de fases previas) | cualquier servicio que supere 8 h brutas (setos, césped grandes, desbroce, fitosanitarios con área grande) |
| T4 | césped (2026-09-11); **reproducido por árboles (2026-09-11) y por arbustos (2026-09-12)** | **✅ CERRADO (Fase 1 del turno 2, 2026-09-13 — cierre formal verificado 2026-09-14).** Al aceptar un cambio de precio, `duration_hours` (y por tanto `end_time` y los bloques de agenda) NO se actualizan — solo cambia `total_price`.** Probado end-to-end: reserva 1000 m² descuidado (216 €/8 h) → jardinero corrige a 1400 m² descuidado y propone 303 € → cliente acepta → `bookings.total_price=303` (correcto) pero `duration_hours` sigue en `8`, `end_time` sigue en la hora original, y `booking_blocks` sigue teniendo solo los bloques originales. Con el motor, 1400 m² descuidado son 11 h reales, no 8. La función solo actualiza `availability` para el rango `[inicio, inicio+duration_hours_ANTIGUO)` — nunca recalcula duración. Consecuencia medida: el "¿se hizo el trabajo?" del cliente se habilita comparando contra `date+start_time+duration_hours` (`needsClientConfirmation`, que usa el mismo `duration_hours` desactualizado), así que el cliente puede ver el aviso de confirmación 3 h antes de que el trabajo real (11 h) pueda haber terminado. | RPC `public.respond_booking_price_change(uuid,boolean,uuid)`, definida en `supabase/migrations/20260909121000_price_change_accept_uses_canonical_schedule.sql:112,117` (`v_duration := COALESCE(v_booking.duration_hours, 1)` — nunca se recalcula) · consumidor del dato desactualizado: `src/shared/bookingStatus.ts:105-111` (`serviceEndMs`) | los 7 servicios — cualquier cambio de precio que también cambie la cantidad/superficie declarada cambia las horas reales, y esta RPC es compartida |

**Cierre (turno 2, 2026-09-14):** el mecanismo se implementó en la Fase 1 vía D5 (decisión del
usuario) — el jardinero puede ahora, junto a la propuesta de precio, pedir también alargar o
acortar el servicio (solo mueve la hora de FIN); `respond_booking_price_change` llama siempre a
`resize_booking_schedule`, que deja `duration_hours`/`end_time`/`booking_blocks`/
`availability_blocks`/`availability` coherentes cuando se usa. Verificado exhaustivamente en la
Fase 1 (alargar, acortar, colisión rechazada limpio). **Cierre formal (Fase 5):** releída la
entrada original línea por línea y reproducido el escenario EXACTO del hallazgo en vivo (precio
corregido SIN tocar el campo de duración, igual que en el repro original de 2026-09-11, antes
de que ese campo existiera) — `total_price` se actualiza, `duration_hours`/`booking_blocks` se
quedan igual. **Esto es el comportamiento correcto, no el bug sin arreglar**: D5 es un mecanismo
opt-in a propósito (decisión del usuario: "el jardinero PUEDA solicitar también..."), no una
inferencia automática de duración a partir del precio — cuando el jardinero no lo usa porque la
corrección no viene de un cambio de tamaño del trabajo, la duración declarada sigue siendo la
correcta y no debe tocarse. El hueco real que describía el hallazgo (ningún mecanismo existía
para corregirla nunca) queda cerrado. El consumidor citado (`bookingStatus.ts:105`,
`serviceEndMs`) lee `duration_hours` en vivo de la fila de BD sin caché, así que hereda
cualquier corrección automáticamente — no necesitó cambios propios. Detalle:
`docs/audit/2026-09-09-transversal/PLAN-IMPLEMENTACION-TURNO2.md`, Fases 1 y 5.

*Reproducción de T4 en árboles (2026-09-11), con un dato adicional que conviene dejar anotado aunque no sea un bug nuevo:* reserva de 1 árbol estructural mediano + dificultad alta (104 €/1,5 h) → jardinero recalcula a estructural grande + dificultad + retirada (225 €/2,5 h) → cliente acepta. Verificado en BD (`bookings id=d45d307d-918c-4e90-864e-19dd3fe60506`): `total_price=225.00` (correcto) pero `duration_hours=2` y `end_time=11:00:00` siguen sin actualizar (deberían ser `3` y `12:00:00` — mismo síntoma que T4). `management_fee` también se queda en `13.00` en vez de recalcular sobre el nuevo total, **pero esto SÍ es diseño deliberado, no parte de T4**: el propio wizard de propuesta de precio se lo dice al jardinero explícitamente («Los gastos de gestión que ya abonaste no cambian»,  visto en pantalla antes de proponer) y el cliente lo ve igual al aceptar. No lo cuentes como hallazgo nuevo si lo vuelves a ver en otro servicio.

*Reproducción de T4 en arbustos (2026-09-12), a petición explícita del usuario de repetir
en vivo lo que se había dado por bueno solo con el motor en proceso:* reserva de 10 m²
pequeñas normal (45,00 €/1h) → jardinero propone 130,00 € desde el chat de solicitudes
pendientes → cliente acepta desde `/bookings`. Verificado en BD
(`bookings id=57b3ac57-5b18-48cb-ae3b-b619f7d7db70`): `status=confirmed`,
`total_price=130.00` (correcto), `price_change_status=accepted`, pero `duration_hours=1` y
`start_time`/`end_time` (`08:00:00`/`09:00:00`) siguen sin actualizar — mismo síntoma que
T4. De paso, se aclara un matiz de mecanismo que no estaba explícito en las entradas
anteriores de T4: el botón de propuesta (`canGardenerProposePrice`,
`src/components/chat/ChatWindow.tsx:103`) solo existe mientras `bookings.status==='pending'`
— no hay forma de proponer un cambio de precio sobre una reserva ya `confirmed` en ningún
sitio de la UI actual. La propuesta se hace ANTES de aceptar, y es la aceptación del
cliente la que confirma la reserva ya al precio nuevo.

| T5 | césped (2026-09-11); **reproducido por árboles (2026-09-11)** | **El botón "Aceptar nuevo precio" / "Rechazar" del DASHBOARD del cliente (`/`, "Hola de nuevo, {nombre}") no hace nada al pulsarlo.** Se renderiza normal (no disabled, sin error visual) pero `cardHandlers` en el componente del dashboard no incluye `onAcceptPriceChange` ni `onRejectPriceChange`, así que el `onClick` del botón llama a `undefined?.(booking)` y no pasa nada: sin request de red, sin cambio de estado. Reproducido con clic real (coordenadas) y con `.click()` programático sobre el elemento — ninguno de los dos dispara nada. **Los mismos botones SÍ funcionan** en `/bookings` (la página completa "Mis reservas", alcanzable con "Ver todas"), que sí conecta `onAcceptPriceChange={() => void respondToPriceChange(booking, true)}`. Un cliente que solo mire el dashboard (lo primero que ve al entrar) no tiene forma de responder a una propuesta de precio. | Roto: `src/components/client/ClientBookingLauncher.tsx:142-150` (objeto `cardHandlers`, sin las dos claves) · Funciona: `src/components/client/BookingsList.tsx:303` | los 7 servicios — `ClientBookingLauncher` es el dashboard genérico, no depende del servicio |
| T6 | césped (2026-09-11); **reproducido por árboles (2026-09-11) y por desbroce (2026-09-12)** | Menor/cosmético: en el panel del jardinero, "Solicitudes de Reserva", la cabecera de cada solicitud muestra `08:00:00 - 16:00:00 (1h)` — el "(1h)" es SIEMPRE 1 aunque el servicio dure 8 h (correcto un poco más abajo, en "Duración estimada: 8h"). Causa: `{request.booking_blocks?.length || 0}h` usa un array sintético de un único elemento `{start_time, end_time}` construido solo para formatear el rango de texto (no son filas reales de la tabla `booking_blocks`, que para esta reserva sí tenía 8 filas correctas en BD). No afecta al precio ni a las horas reales, pero es una cifra visiblemente incoherente en la misma pantalla y podría hacer dudar al jardinero sobre cuánto dura el trabajo antes de aceptar. Árboles reprodujo con `09:00:00 - 11:00:00 (1h)` junto a "Duración estimada: 2h" en la misma solicitud. | `src/components/gardener/BookingRequestsManager.tsx:502` (usa `.length` del array sintético de `:224`) en vez de `request.duration_hours` (correcto, usado en `:513`) | los 7 servicios — `BookingRequestsManager` es el panel de solicitudes genérico |
| T10 | árboles (2026-09-11) | Menor/cosmético: en `ProvidersPage`, tras elegir hora, el texto "Horario del trabajo: HH:MM – HH:MM" usa `String(selectedHour + estimatedHours).padStart(2,'0')` — con horas fraccionarias (`.5`) el resultado es literalmente `10.5:00` en vez de `10:30`. Reproducido eligiendo un servicio de árboles con `estimatedHours=1.5` a las 09:00 → "09:00 – 10.5:00". No afecta al precio, a las horas bloqueadas en agenda (esas sí redondean bien) ni a `booking_blocks`; es solo el texto de esta pantalla concreta. Cualquier servicio cuya duración caiga en fracción de hora lo dispara. | `src/pages/reserva/ProvidersPage.tsx:1008` (`{String(selectedHour + getEstimatedHours(selectedProvider)).padStart(2,'0')}:00`, no convierte la fracción a minutos) | los 7 servicios — `ProvidersPage` es compartida; se dispara con cualquier `estimatedHours` no entero (0.5, 1.5, 2.5…) |
| T9 | árboles (2026-09-11); **reproducido por desbroce (2026-09-12)** | **En "Solicitudes de Reserva" del jardinero, el nombre del cliente siempre muestra "Cliente desconocido", para cualquier cliente y cualquier servicio.** Causa confirmada por SQL: la consulta filtra `profiles` por `.eq('id', client_id)` / `.in('id', clientIds)`, pero `bookings.client_id` guarda el `user_id` del cliente, no el `id` (PK) de `profiles` — son valores distintos (`profiles.id=d86bf1ce-...` vs `profiles.user_id=bookings.client_id=22222222-bbbb-...` para el cliente de pruebas). El filtro nunca encuentra fila y cae siempre al fallback `{ full_name: 'Cliente desconocido' }`. Confirmado que NO es un problema de datos: el mismo cliente aparece correctamente como "Laura Fernández" en "Mis Reservas" del jardinero (pantalla distinta, consulta distinta) y en el dashboard del jardinero. El jardinero no puede saber quién es el cliente antes de aceptar una solicitud — en ningún servicio. | `src/components/gardener/BookingRequestsManager.tsx:156,163` (`.eq('id', singleId)` / `.in('id', clientIdsFiltered)` sobre `profiles`, debería ser `.eq('user_id', ...)` / `.in('user_id', ...)`) | los 7 servicios — mismo componente `BookingRequestsManager`, reproducible con cualquier solicitud pendiente de cualquier servicio |
| T11 | árboles (2026-09-11); **reproducido por desbroce (2026-09-12) con un pago real completo** | **✅ CERRADO (turno 2, 2026-09-14).** Causa raíz confirmada leyendo el bundle real de `@supabase/supabase-js@2.116.0`/`@supabase/functions-js@2.116.0` resuelto por el import sin pin de esm.sh (no la hipótesis de versión entre aislados de Deno, descartada): `createClient(url, key)` fija `this.headers = options.global.headers ?? {}`, vacío si no se pasa `global.headers`; `.rpc()`/`.from()` resuelven la clave de servicio por su cuenta, `functions.invoke()` no — nunca manda `Authorization` salvo que se le pase explícito. Un `grep -rln ".functions.invoke("` sobre todas las edge functions encontró el mismo patrón en 4 sitios de 3 archivos (no solo el de `booking-payment-webhook` documentado abajo): también `booking-complete/index.ts` (aviso al cliente de que el jardinero terminó) y `booking-payment/index.ts` ×2 (cancelación e incidencia resuelta). Fix aplicado a los 4: `headers: { Authorization: \`Bearer ${serviceRoleKey}\` } }` explícito en la llamada (en `booking-payment-webhook` la llamada vive en una función que no recibe `serviceRoleKey` como parámetro, se usa el resolver local `resolveServiceRoleKey()` del propio archivo). **Verificado en vivo de principio a fin para el call-site original:** reserva real con pago Stripe completo (césped 200m²) + `stripe listen --forward-to http://127.0.0.1:54321/functions/v1/booking-payment-webhook` reenviando al stack local (el secreto de firma que imprime coincide con el ya configurado, la CLI de Stripe mantiene uno estable por cuenta) → el evento `payment_intent.amount_capturable_updated` se reenvía y procesa con `200`, y `docker logs supabase_edge_runtime_GarSer-referencia` confirma que `booking-confirmation-email` **ahora sí se invoca** y llega al envío (`MOCK EMAIL (client)`/`MOCK EMAIL (gardener)` — el fallback esperado del propio `booking-confirmation-email/index.ts` cuando faltan credenciales SMTP en local, no un error; antes del fix esta invocación ni se producía, moría en el 401 silencioso). Los otros 3 call-sites (mismo fix byte a byte, misma causa raíz) verificados por `deno check` sin regresión de baseline en los 3 archivos y revisión de código, pero **NO PROBADO en vivo end-to-end** — disparar una cancelación o una incidencia resuelta real no se ejecutó por alcance de tiempo de esta fase. `tsc` 171/171, `vitest` 455/455, 7/7 runners en verde. Detalle completo: `docs/audit/2026-09-09-transversal/PLAN-IMPLEMENTACION-TURNO2.md`, Fase 6. Commit `6d6263c`. **Hallazgo original (para contexto):** **el email de confirmación de reserva (cliente + jardinero) no se enviaba nunca, ni siquiera con el webhook de Stripe funcionando correctamente.** Antes de hoy, `STRIPE_WEBHOOK_SECRET` no estaba configurado en el entorno local y el webhook nunca llegaba a probarse — hoy el usuario lo configuró (Stripe CLI + `stripe listen`) y se pudo probar por primera vez. Reproducido de punta a punta con pago real: `docker logs supabase_edge_runtime_GarSer-referencia` confirma 3 invocaciones a `booking-payment-webhook` (uno de los eventos, `payment_intent.amount_capturable_updated`, crea la reserva correctamente — `bookings id=f84327b5-...` con `status=pending`, verificado en BD) y **exactamente 1 intento** de invocar `booking-confirmation-email`, que devuelve `401 Unauthorized` (log completo con el `FunctionsHttpError` y la respuesta de Kong). Mailpit confirma 0 mensajes en el buzón tras el pago. **No es el problema histórico ya documentado en `docs/audit/2026-07-12/PROGRESO.md:51`** (gateway 401 por `verify_jwt`, ya resuelto: `booking-confirmation-email` tiene `verify_jwt=false` en `config.toml` tanto en este worktree como en el checkout de referencia) — **descartado explícitamente**: llamando a `booking-confirmation-email` directamente por `curl` con el `SUPABASE_SERVICE_ROLE_KEY` exacto del contenedor como `Authorization: Bearer`, la función responde `200 OK` (`isInternalServiceCaller` lo acepta sin problema). El 401 solo ocurre cuando la llamada sale de `admin.functions.invoke(...)` **dentro** de `booking-payment-webhook` — mismo `admin`, mismo `resolveServiceRoleKey()`, mismo entorno compartido, pero falla. Hipótesis más probable, sin confirmar: el import sin versión fija `from 'https://esm.sh/@supabase/supabase-js@2'` (en ambas funciones) puede resolver una versión de `supabase-js` distinta en cada aislado de Deno, y algún cambio de comportamiento en `functions.invoke()` (qué cabecera `Authorization` construye) explicaría que el mismo código, con la misma clave, funcione por `curl` y falle desde dentro del SDK. Próximo paso para quien lo arregle: loguear (temporalmente) la cabecera `Authorization` que `isInternalServiceCaller` recibe en ese caso concreto, o sustituir `admin.functions.invoke(...)` por un `fetch()` crudo con la cabecera explícita como comprobación. Consecuencia: en producción, si el patrón se repite, **ninguna reserva pagada dispara el email de confirmación al cliente ni al jardinero**, con o sin webhook configurado — el pago y la creación de la reserva no se ven afectados (el `catch` de la llamada lo traga, "no bloqueante" por diseño), pero la notificación desaparece en silencio. **Reproducido de nuevo por desbroce (2026-09-12)** con un ciclo de pago real independiente (reserva `84990e26-5c8e-4b70-b3bd-8d4d4c34259a`, PaymentIntent `pi_3UErsL2MwFyGXuB71BHdDTOw` capturado tras aceptación del jardinero): `GET http://127.0.0.1:54324/api/v1/messages` devuelve `"count":0` tras el pago. | Guarda que rechaza: `supabase/functions/booking-confirmation-email/index.ts:57` (`isInternalServiceCaller`) · Llamada que falla: `supabase/functions/booking-payment-webhook/index.ts:644` (`admin.functions.invoke('booking-confirmation-email', ...)`) · Guarda compartida: `supabase/functions/_shared/functionAuth.ts:52` | los 7 servicios — el pipeline de email de confirmación es genérico, no específico de árboles |
| T7 | césped (2026-09-11); **reproducido en vivo por desbroce (2026-09-12)** | **✅ CERRADO (turno 2, 2026-09-14).** Fix mínimo y honesto por decisión del usuario (D4-a): un primer diseño comparaba el hueco libre más largo de cada fecha escaneada contra la duración pedida, dentro de la rama `!earliestSlot` de `evaluateOperationalEligibility` — se demostró lógicamente imposible (2 de 3 tests nuevos fallaban): por construcción, `getValidStartHours(...).length > 0` equivale a que el hueco más largo sea `>= duración`, así que al llegar a esa rama TODAS las fechas ya tienen, necesariamente, un hueco más corto que lo pedido — la comparación siempre salía verdadera y el código era papel mojado. Rediseño final en `src/shared/bookingEligibilityCore.ts`: comparar la duración contra `MAX_SINGLE_DAY_DURATION_HOURS = 12`, el mismo tope que ya aplica todo el sistema (`duration_hours <= 12` en ~7 migraciones SQL), de forma incondicional y ANTES de escanear ninguna agenda — nuevo código `service_exceeds_single_day`, mensaje también en `ProvidersPage.tsx`. **Verificado en vivo por HTTP directo a `booking-authority`** (no solo `READINESS_ENGINE=local`): césped 2200/2500/3000 m² → `service_exceeds_single_day` con "14/15/18 horas seguidas..." exacto, `quotes:{}` (ni mira la agenda). **Verificado en vivo en el navegador**: reserva manual césped 3000 m² hasta `ProvidersPage` → mensaje "Este trabajo necesita más horas seguidas de las que caben en una sola jornada..." renderizado tal cual (se encontró y corrigió un problema de infraestructura de pruebas en el camino — el dev server lanzado por nombre resolvía el `.claude/launch.json` equivocado, de un clon no relacionado; detalle completo en el plan de fase). `tsc` 171/171, `vitest` 455/455 (+2), 7/7 runners en verde. Detalle completo: `docs/audit/2026-09-09-transversal/PLAN-IMPLEMENTACION-TURNO2.md`, Fase 6. Commit `b8523b4`. **Hallazgo original (para contexto): un trabajo que no cabía en un único día se quedaba sin ningún hueco reservable en ninguna fecha, y sin ningún aviso al cliente de por qué.** El fixture solo siembra jornadas de un día (L-V 08-18 = 10 bloques de 1h, sábado 5). Cualquier servicio cuyas horas estimadas superen esos 10 bloques queda excluido de `preview_providers`/`valid_hours` en **todas** las fechas probadas (21 días), con el mismo código genérico `no_reservable_availability` que se usa para "esta fecha en concreto no tiene hueco" — nada distingue "prueba otro día" de "este trabajo no se puede reservar nunca". Es un hueco de producto general al tamaño del trabajo, no a ningún estado concreto: reproducido con **1700 m² de césped en estado NORMAL** (sin recargo alguno, `(1700/150)·0,9=10,2h→10,5h→11 bloques`) — falta reserva multi-día o, como mínimo, un aviso de "trabajo extenso" antes de mandar al cliente a un paso de selección sin huecos. **Desbroce lo reprodujo en el navegador, no solo por API**, con un caso plausible de cliente real: 1000 m² a dificultad alta (13h con su propio bug de horas sin corregir, o 11,5h incluso con el % correcto) → `preview_providers` devuelve `quotes:{}`, `eligibleProviderIds:[]`, y la pantalla de selección de jardinero muestra literalmente "No hay profesionales disponibles" sin ninguna pista de que la causa es el tamaño del trabajo. | No hay ningún sitio que calcule "¿cabe este trabajo en algún día?" de forma explícita ni que avise de ello; el síntoma se observa en `supabase/functions/booking-authority/index.ts` (acciones `preview_providers`/`valid_hours`, exclusión `no_reservable_availability`) | los 7 servicios — cualquiera cuyo `estimatedHours` pueda superar la jornada más larga sembrada para un profesional |
| T8 | árboles (2026-09-11) | **✅ CERRADO (turno 2, 2026-09-14).** Cuando el sondeo del cliente agota sus intentos (`POLL_MAX_ATTEMPTS=8` × `POLL_INTERVAL_MS=1500` ≈ 12 s) con el intento **todavía** en `payment_pending` (ni `booking_created`, ni `processing`, ni ningún otro estado terminal), el callback `onConfirmed` no entra en **ninguna** de sus tres ramas (`booking_created` / `processing` / `status !== 'payment_pending'`) y no hace nada: ni `toast.error`, ni aviso, ni retry guiado. El formulario de pago simplemente vuelve a su estado inicial con la tarjeta ya rellenada, como si no se hubiera intentado nada — mientras Stripe puede tener el importe ya autorizado. Un reintento del cliente sobre ese mismo `PaymentIntent` ya confirmado falla con «Se ha producido un error de procesamiento», también sin explicar por qué. Detectado la madrugada del 2026-09-11 mientras el stack de referencia servía una versión de `booking-payment` desactualizada respecto a `origin/main` (por entonces sin `|| paymentIntentStatus === 'requires_capture'`), que hacía que el sondeo agotara siempre sus intentos; el stack ya se actualizó (§4b, tras el merge de la PR #20) así que ese disparador concreto ya no debería ocurrir en el camino feliz, pero el hueco de manejo de errores en sí — ninguna rama cubre "el sondeo se agotó y sigue pendiente" — sigue presente en el código y lo dispara cualquier lentitud real de Stripe/red. **Cierre (turno 2, 2026-09-14):** nueva rama para `latest?.status === 'payment_pending'` con un aviso informativo (no error) que sugiere actualizar antes de reintentar, sin reintentar sola ni bloquear el formulario (un reintento automático sobre el mismo `PaymentIntent` ya confirmado falla con un error confuso, según el propio hallazgo). Verificado con una reserva real y pago Stripe completo en el navegador (confirma que la rama `booking_created`, justo al lado, y el resto del flujo de pago siguen intactos). **La rama nueva en sí queda NO PROBADO en vivo**: forzar que Stripe tarde >12 s reales sin manipular el estado de un intento de pago compartido no era seguro ni práctico en este entorno — verificada por revisión de código + `tsc` únicamente, documentado así explícitamente. `tsc` 171/171, `vitest` 453/453, 7/7 runners en verde. Detalle: `docs/audit/2026-09-09-transversal/PLAN-IMPLEMENTACION-TURNO2.md`, Fase 5. Commit `e013e8a`. | `src/pages/reserva/ConfirmationPage.tsx:2098-2119` (línea movida por cambios acumulados de fases previas) | Los 7 servicios: `ConfirmationPage.tsx` y el sondeo de pago son compartidos, no específicos de árboles. |

| T12 | fitosanitarios (2026-09-12) | **✅ CERRADO (turno 2, 2026-09-14).** Los seis configuradores comparan `config.pricing_method === 'per_quantity'` en crudo, en vez de usar `getPricingMethod()` — la SSOT que sí usa el motor y que devuelve `per_quantity` cuando la clave falta. Consecuencia cuando falta: el motor factura por cantidad pero la pantalla **esconde toda la sección de tarifas por categoría**, y el profesional no puede configurar su servicio ni ver lo que cobra; el selector, además, no muestra ningún método marcado aunque el texto de abajo diga «tus tarifas fijas por categoría». Reproducido en vivo: el panel de fitosanitarios enseñaba 9 campos (mínimo, 6 rendimientos, 2 suplementos) y tras el fix enseña 35. **Alcance real hoy:** solo se manifiesta si al profesional le falta la clave, y de los 7 servicios sembrados solo les falta a **fitosanitarios** (ya corregido en su rama) y a **desbroce** (sin tocar). Los otros cinco la tienen a `per_quantity` y funcionan por coincidencia, no por diseño. **Corrección (desbroce, 2026-09-12): no se reproduce en `WeedingPricingConfigurator.tsx`.** Verificado leyendo el fichero completo (367 líneas) y con `grep -rn "pricing_method" src/` sobre todo el repo: `WeedingPricingConfigurator.tsx` no contiene ninguna referencia a `pricing_method` ni a `getPricingMethod` — no tiene selector de método de tarifa (desbroce es exclusivamente por m², como poda de árboles es exclusivamente por unidad) y todas sus secciones (mínimo, velocidad, precio base, herbicida, suplementos) se renderizan siempre, sin condición. La afirmación "hoy afecta de verdad a desbroce" era un falso positivo — mismo tipo de corrección que T13 ya recibió para fitosanitarios. Queda **5 configuradores** con el patrón real (Lawn, Hedge, Palm, Shrub, y Phytosanitary ya corregido), no 6. **Cierre (turno 2, 2026-09-14): al re-verificar antes de tocar código, Palm resultó NO estar afectado** — `PalmPricingConfigurator.tsx` ya resolvía `pricing_method` con `getPricingMethod()` en el punto donde deriva `config` (línea ~104), así que sus comparaciones `config.pricing_method === '...'` leían un valor ya normalizado pese a parecer en crudo por `grep`. Falso positivo dentro de un falso positivo. **T12 real: 3 configuradores** (Lawn, Hedge, Shrub), los 3 corregidos con el mismo patrón que ya usaba Phytosanitary. Verificado: `tsc` 171/171 (baseline), `vitest` 453/453, 7/7 runners en verde. Commits `a5c7500` (Lawn) y `16d8eb5` (Hedge y Shrub, junto con el fix de autoguardado espurio de esos mismos ficheros — ver nota más abajo). | `PhytosanitaryPricingConfigurator.tsx` (corregido), y el mismo patrón en `LawnPricingConfigurator.tsx`, `HedgePricingConfigurator.tsx`, `ShrubPricingConfigurator.tsx` — **no** en `WeedingPricingConfigurator.tsx` ni en `PalmPricingConfigurator.tsx` (ver corrección) · SSOT: `src/utils/hourlyPricing.ts:19` | Lawn, Hedge, Shrub — corregidos; Weeding y Palm descartados |
| ~~T13~~ | fitosanitarios (2026-09-12) | **RETIRADO: era un falso positivo.** Se anotó que «Solicitudes de Reserva» seguía mostrando «Retirada de restos incluida» pese a llegar `wasteRemoval: false`. Al verificarlo contra un stack con el código corregido resultó que el panel **sí condiciona al flag**: lo que se había observado era una reserva creada ANTES del cambio del builder, es decir con `wasteRemoval: true` guardado. Comprobado con una reserva nueva de fitosanitarios (`1fc77a3a-…`, `declared_variables.wasteRemoval = false`): el panel del profesional no menciona la retirada. No hay nada que arreglar aquí. Se deja la fila, tachada, para que nadie vuelva a anotarlo. |

**Extensión de T1 (fitosanitarios, 2026-09-12) — el vacío se confirma en el servicio que le
da nombre, y el mensaje de exclusión además miente sobre la causa.** Dos cosas nuevas, ambas
navegadas en vivo: (1) el jardinero sembrado, **sin licencia verificada**, se ofreció y cobró
tratamientos con producto **químico convencional** en los 12 casos navegados que lo pidieron —
mientras su propio configurador le promete por escrito que «solo aparecerás en búsquedas de
tratamientos ecológicos hasta que subas y se verifique tu carnet». La promesa al profesional no
se cumple, igual que no se cumple la garantía al cliente. (2) **El texto que se muestra cuando
no hay profesionales atribuye la exclusión a la licencia aunque la causa sea otra**: con
5000 m² de césped (11,5 h, más que la jornada sembrada de 10 h → es T7) la pantalla dice *«Este
servicio requiere una licencia fitosanitaria válida y ahora mismo no hay disponibilidad
compatible en tu zona»* y *«Solo podemos mostrar profesionales con licencia fitosanitaria
válida»*. El filtro que ese texto invoca no existe (es justo lo que T1 establece), y el mismo
jardinero aparece sin problema para 1000 m². Un cliente —o soporte— concluiría que no hay
profesionales con carnet en Marbella, cuando el problema es que el trabajo no cabe en un día.
Cuando se arregle T1 conviene arreglar también el mensaje: hoy desinforma en los dos sentidos.
Informe completo: `docs/audit/2026-09-12-fitosanitarios/REPORT.md` §5.

**Tercera comprobación del patrón de autoguardado en el primer render (fitosanitarios,
2026-09-12) — negativa, y por tanto buena noticia.** Siguiendo el aviso que dejaron setos y
palmeras, se abrió `PhytosanitaryPricingConfigurator` y se esperó sin tocar nada: el
`additional_config` quedó **intacto** (`md5 = 46bfc95e68d72ce08c6e240ec18eb49a`, longitud 1406,
`updated_at` sin moverse del 2026-09-06). **Fitosanitarios queda descartado**; van 2 de 7
afectados confirmados (setos, palmeras) y 3 de 7 descartados (césped y árboles cerraron sin
mencionarlo, fitosanitarios comprobado explícitamente). Siguen sin revisar bajo esta pregunta
**arbustos y desbroce**.

**Cuarta comprobación del patrón de autoguardado en el primer render (desbroce,
2026-09-12) — también negativa.** Se abrió `WeedingPricingConfigurator` y se esperó sin
tocar nada: el `additional_config` quedó **intacto** (`md5 =
06d7c214a7ad7d0d2b8b0ce66332df5e`, longitud 192, `updated_at` sin moverse del
2026-09-06 00:43:35). **Desbroce queda descartado**; van 2 de 7 afectados confirmados
(setos, palmeras) y **4 de 7 descartados** (césped, árboles, fitosanitarios, desbroce).
Solo **arbustos** sigue sin revisar bajo esta pregunta concreta.

**✅ CERRADO (turno 2, 2026-09-14) — y la respuesta que se daba por buena para dos servicios
era incompleta.** Al revisar arbustos (la única pregunta que quedaba abierta) se comprobó en
vivo, con hash MD5 de `additional_config` antes/después de abrir cada configurador sin tocar
nada, los 7 servicios de una vez — no solo el que faltaba:

- **Arbustos: afectado** (cierra la pregunta abierta).
- **Setos y palmeras: SIGUEN afectados**, pese al fix que cada uno ya tenía documentado como
  cerrado en su propia auditoría (2026-09-11/12). Esos fixes corrigieron el disparador
  concreto que se había medido entonces (`specialist_enabled` en setos, migración de
  `selected_species` en palmeras) pero no la causa de fondo: `useAutoSave` seguía comparando
  `value: config` (normalizado) contra `initialValue: initialConfig || EMPTY_CONFIG` (sin
  normalizar) — cualquier otro campo cuya forma cruda difiriera de la normalizada disparaba
  igual el autoguardado. El propio código de setos llevaba un comentario sin resolver
  reconociéndolo (*"Note: maybe need a processed base like in isDirty"*).
- **Árboles: NUEVO, nunca antes probado.** Se daba por "descartado" solo porque su Fase 2/3
  "cerró sin mencionarlo" — una inferencia, no una comprobación. Estaba afectado, con una
  variante de causa propia: un `useEffect` ponía `config` al `value` crudo nada más llegar,
  sin pasar por la normalización que sí aplicaba al lado `initialValue`.
- Césped, desbroce y fitosanitarios: re-confirmados sin problema.

Fix aplicado a los 4 afectados (setos, palmeras, árboles, arbustos): extraer la normalización
a una función con nombre y usarla en los dos lados de la comparación de `useAutoSave` — el
patrón que `LawnPricingConfigurator.tsx` ya usaba de origen, el único inmune desde el
principio. Verificado en vivo uno a uno (hash idéntico antes/después de abrir; un cambio real
del jardinero se sigue guardando con normalidad) y con el gate técnico completo (`tsc`
171/171, `vitest` 453/453, 7/7 runners en verde). Commit `16d8eb5` (junto con el cierre de T12
para setos y arbustos, misma extracción). Detalle completo:
`docs/audit/2026-09-09-transversal/PLAN-IMPLEMENTACION-TURNO2.md`, Fase 3.

**Extensión de T1 (palmeras, 2026-09-11):** el mismo vacío de T1 (ninguna capa comprueba
`has_phytosanitary_license`) alcanza también al extra `hasPhytosanitary`/`phytosanitary`
de **Poda de palmeras** (p. ej. tratamiento contra el Picudo Rojo — también sujeto al RD
1311/2012), no solo a fitosanitarios/desbroce. `ProvidersPage.tsx:405-411` calcula
`requiresChemical` únicamente para `serviceInfo?.name === 'Servicios fitosanitarios'` o
`'Desbroce de malas hierbas'`, nunca para `'Poda de palmeras'` — y aunque lo calculara, T1
ya establece que el flag es cosmético (cambia un texto, no filtra la lista). No se cuenta
como hallazgo nuevo: es la misma causa raíz de T1 con un tercer servicio afectado. Informe
completo: `docs/audit/2026-09-11-palmeras/REPORT.md` §7.

**Segunda confirmación del patrón de autoguardado en el primer render (palmeras,
2026-09-11):** el aviso que dejó setos en §2 sobre `useAutoSave` (un guardado no
solicitado al segundo de abrir un configurador cuya forma derivada no es `deepEqual` al
`initialConfig` crudo de BD) se confirma también en `PalmPricingConfigurator.tsx`, con un
disparador distinto al de setos: la migración de `selected_species` (`:126-137`) mira
`species_prices` (todos a 0 en el jardinero sembrado, cuyos precios reales viven en
`height_prices`) en vez de mirar si `height_prices` ya tiene datos, así que infiere
`selected_species = []` y lo autoguarda sin que el jardinero toque nada. Reproducido con
SQL antes/después: `additional_config` pasa de no tener la clave `selected_species` a
tenerla como `[]` en ~1 segundo, con `height_prices`/`yield_units_per_hour` intactos (el
precio al cliente sigue siendo correcto) pero la UI mostrando "No hay especies
seleccionadas" pese a 6 especies reales configuradas. Van 2 de 7 configuradores con el
problema confirmado (setos, palmeras); arbustos, desbroce y fitosanitarios siguen sin
revisar bajo esta pregunta concreta — cesped y árboles cerraron su Fase 2/3 sin
mencionarlo. El fix de palmeras, igual que el de setos, cabe entero en su propio
configurador sin tocar `useAutoSave.ts`. Informe completo:
`docs/audit/2026-09-11-palmeras/REPORT.md` §1 (hallazgo #3) y §7.

---

## 4. Cómo se cierra un servicio

1. Runner en verde con el motor en proceso: `READINESS_ENGINE=local node scripts/readiness/<servicio>.mjs`
2. **Tipos:** `npx tsc --noEmit -p tsconfig.app.json` — este es el gate real. `tsconfig.json`
   tiene `"files": []` y sólo `references`, así que `tsc -p tsconfig.json` NO comprueba ningún
   fichero (siempre pasa: es un no-op). Criterio: `main` arrastra **173 errores** (en su
   mayoría `TS6133` de variables sin usar); el número **no puede subir de 173**, y cualquier
   fichero que toque tu servicio queda **sin errores nuevos**. `npx vitest run` sin fallos.
3. Informe al usuario. **Él abre la PR y decide el turno.**
4. **Tras el merge, dos cosas en el mismo momento. Las dos, siempre.**

   **4a · Producción.** El orden importa: la base de datos, luego las funciones, luego el
   front.

   ```bash
   supabase db push
   ```
   ```bash
   supabase functions deploy <fn> --use-api
   ```

   Y por último Vercel.

   **4b · El entorno local compartido.** Lo hace el usuario, no un chat de servicio:
   reiniciar Supabase corta a todas las sesiones unos segundos. Sin este paso, el stack
   sigue sirviendo las funciones y el esquema de antes del merge, y los chats miden código
   viejo sin enterarse. **Ya pasó el 2026-09-10**: se mezcló el #18 con el arreglo del
   pago, el stack no se actualizó, y un chat de servicio vio el pago fallar igual que antes.

   Traer el código y reiniciar, para que Supabase cargue las funciones nuevas:

   ```bash
   cd ~/Downloads/GarSer-referencia && git pull && supabase stop && supabase start
   ```

   Aplicar las migraciones a la base local, sin borrar datos:

   ```bash
   cd ~/Downloads/GarSer-referencia && supabase migration up
   ```

   Comprobar que no queda ninguna pendiente. **Si no imprime nada, está al día**:

   ```bash
   cd ~/Downloads/GarSer-referencia && comm -23 <(ls supabase/migrations/*.sql | xargs -n1 basename | cut -d_ -f1 | sort -u) <(docker exec -i supabase_db_GarSer-referencia psql -U postgres -d postgres -tAc "select version from supabase_migrations.schema_migrations" | sort -u)
   ```

   Y avisar a los chats activos: *«El entorno compartido se ha actualizado con el merge de
   la PR #N. Rebasa tu worktree sobre `origin/main` y repite las pruebas que pasen por lo
   que ha cambiado: lo medido antes ya no vale.»*
5. Se ejecutan **todos** los runners, ya por HTTP, no solo el del servicio recién integrado.
6. Siguiente servicio.

**Hecho para setos el 2026-09-11 (merge y despliegue realizados por el chat, no por el
usuario, que estaba remoto desde el móvil — excepción puntual, no el flujo por defecto):**
PR #22 (fix) y #23 (ajuste del runner) fusionadas por squash, `booking-authority` redesplegado
(`supabase functions deploy booking-authority --project-ref hleqspdnjfswrmozjkai --use-api`),
`supabase db push --dry-run` confirmó que no había migraciones pendientes. Entorno local
compartido actualizado: `git pull` + `supabase stop && supabase start` +
`supabase migration up` (0 aplicadas) en `~/Downloads/GarSer-referencia`, sin migraciones
pendientes tras reiniciar. **No había forma de avisar a las sesiones activas en tiempo real**
(sin herramienta de mensajería entre sesiones en este entorno) — si tu sesión estaba en medio
de algo cuando Supabase se reinició (hora aproximada: 2026-09-11 ~19:40 UTC) y algo falló sin
motivo aparente, es probablemente por eso; vuelve a intentarlo.

**Paso 5 (todos los runners por HTTP) ejecutado — hallazgo a tener en cuenta si aún no has
empezado tu Fase 1:** además de setos (ya corregido) y árboles (15/15 PASA, sin cambios),
**arbustos, desbroce, palmeras y fitosanitarios fallan sus runners al completo**
(`missing_provider_config`/`inactive_service` en prácticamente todos los escenarios) — **no es
un fallo del entorno ni de este merge**, es el mismo patrón que setos y árboles ya encontraron
en su propia Fase 1: el `serviceId` hardcodeado en el runner heredado de la tanda anterior es
**fantasma** (no existe en este entorno). Confirmado comparando contra
`select id, name from public.services`:

| Servicio | `serviceId` en el runner (fantasma) | `serviceId` real en BD |
|---|---|---|
| Arbustos | `40798630-0bce-4fac-9208-b75ffb59d280` | `649bcd71-514e-4438-ad64-1136172de98a` |
| Desbroce | `e2bb35b1-d9e8-47bf-a609-e908f6d258ca` | `d946c65f-c588-4103-baca-0317667f04aa` |
| Palmeras | `7f1b414c-d007-4c73-b1c3-08f7d1954582` | `8e5a99f5-5ab5-40c7-b4f3-a9272c08f47e` |
| Fitosanitarios | `47a66caa-7671-45ec-b321-df6179249efd` | `fc96088a-81f8-4efc-8908-b28a401ea556` |

`references/servicios.md` (la skill) también tiene estos cuatro IDs desactualizados — no te
fíes de ese fichero para el `serviceId`, verifica siempre contra la BD (esto ya lo dice la
skill, pero conviene subrayarlo: van 4 de 4 servicios auditados hasta ahora con el ID
fantasma, palmeras incluida el 2026-09-11 — su runner ya está corregido). **No se ha
tocado ningún runner de arbustos, desbroce ni fitosanitarios** — corresponde a cada
auditoría arreglar el suyo en su propia Fase 1/2, igual que hicieron césped, árboles,
setos y palmeras.

**Desbroce fusionado (2026-09-12/13): PR [#28](https://github.com/mjgardenproject-dev/GarSer/pull/28)
(hallazgos #1-#3: validación manual, horas reales, aviso de plausibilidad) y PR
[#29](https://github.com/mjgardenproject-dev/GarSer/pull/29) (hallazgo #4 — herbicida con
tiempo proporcional — y la unificación de desbroce con `ManualEntryWizard`), ambas
mezcladas por el usuario. El #29 necesitó un rebase + `--force-with-lease` sobre
`origin/main` antes de poder abrirse: el squash-merge del #28 dejó el commit de la segunda
ronda huérfano en la rama con un conflicto real (no solo un diff feo) contra el nuevo
commit de `main` — si a otra auditoría le pasa lo mismo (dos rondas de fix, la primera ya
fusionada por squash antes de subir la segunda), el arreglo es exactamente ese: `git fetch
origin && git rebase origin/main` (git detecta solo que el commit ya squasheado es
equivalente y lo salta) y luego `git push --force-with-lease` — seguro solo si eres el
único que ha tocado esa rama.

**Secuencia de cierre para este merge (dada al usuario el 2026-09-13):**
```bash
cd ~/Downloads/GarSer-referencia && git pull
cd ~/Downloads/GarSer-referencia && supabase functions deploy booking-authority --project-ref hleqspdnjfswrmozjkai --use-api
cd ~/Downloads/GarSer-referencia && supabase stop && supabase start
cd ~/Downloads/GarSer-referencia && supabase migration up
comm -23 <(ls ~/Downloads/GarSer-referencia/supabase/migrations/*.sql | xargs -n1 basename | cut -d_ -f1 | sort -u) <(docker exec -i supabase_db_GarSer-referencia psql -U postgres -d postgres -tAc "select version from supabase_migrations.schema_migrations" | sort -u)
cd ~/Downloads/auditorias/desbroce && SUPABASE_PROJECT_DIR=~/Downloads/GarSer-referencia SUPABASE_DB_CONTAINER=supabase_db_GarSer-referencia bash -c 'for r in scripts/readiness/*.mjs; do node "$r" || echo "FALLA $r"; done'
```
**Corrección (2026-09-13) al primer intento de este último paso:** sin
`SUPABASE_PROJECT_DIR`, el harness intenta `supabase status -o json` desde
`~/Downloads/auditorias/desbroce` (que no es el checkout donde está el stack levantado) y
falla para los 7 runners con *"No se pudo leer 'supabase status'"*; y `fitosanitarios.mjs`
en concreto además necesita `SUPABASE_DB_CONTAINER`, porque llama a `sql()` directamente
con el nombre de contenedor por defecto del harness (`supabase_db_GarSer-main_4`), que no
es el real en este entorno. Las dos variables ya están en el comando de arriba — si otra
auditoría corre este mismo paso 6 fuera de `GarSer-referencia`, necesita las dos.

Ninguna migración nueva esperada (ni el #28 ni el #29 tocan `supabase/migrations/`). Si tu
sesión estaba en medio de algo cuando se reinició Supabase para este merge y algo falló sin
motivo aparente, es probablemente por eso — rebasa tu worktree sobre `origin/main` y
repite lo que dependa de `bookingQuoteCore.ts` o `DetailsPage.tsx` (los dos ficheros
compartidos que esta rama tocó, cada uno contenido en su propio bloque de desbroce — ver
la fila de cada uno en §2).

**Paso 6 ejecutado (2026-09-13) — resultado por servicio, para que cada sesión sepa si el
fallo que ve es suyo o preexistente:**

| Runner | Resultado | ¿Causado por el merge de desbroce? |
|---|---|---|
| `desbroce.mjs` | 18 PASA/1 FALLA al momento de correrlo, **19/0 tras un ajuste al propio runner** (ver abajo) | — (es el que se acaba de mezclar) |
| `fitosanitarios.mjs` | 78 PASA/0 FALLA | No afectado |
| `arboles.mjs`, `cesped.mjs`, `arbustos.mjs`, `palmeras.mjs`, `setos.mjs` | Cada uno con 1-3 FALLA | **No** — las cuatro causas son preexistentes, ninguna toca código de desbroce ni ningún fichero que esta rama haya modificado |

Dos causas, ninguna relacionada con este merge:

1. **Avisos de plausibilidad aplanados a string por HTTP.** `booking-authority` devuelve
   `warnings` como `{code,message}` en el motor en proceso pero como texto plano por HTTP
   (mismo contrato que setos ya documentó: PR #23, *"ajuste del runner al contrato de
   warnings por HTTP — no era un fallo del fix, solo de cómo lo comprobaba el runner"*).
   Afecta a los runners que comprueban `warning.code` en vez del texto: `desbroce.mjs`
   (`4e`, corregido en el momento — ver abajo), `arbustos.mjs` (`shrub_area_implausible`),
   `palmeras.mjs` (`palm_terminal_range` y el aviso de 500 palmeras), y probablemente
   `cesped.mjs` (`lawn_area_implausible` y el par 2000/2001 m²). El aviso en sí **sí se
   dispara correctamente** en los cuatro casos — se ve el texto completo en el `obtenido`
   de cada fallo — el defecto está en cómo cada runner lo comprueba, no en el motor.
2. **Fecha de prueba caducada.** `cesped.mjs` y `setos.mjs` tienen `2026-09-20` hardcodeado
   esperando un día laborable; hoy (2026-09-13) esa fecha ya es un **domingo**, no lo que
   era cuando se escribió el runner. Hace falta mover la fecha a otro laborable futuro con
   margen (`min_notice_hours`), como ya se hizo en `desbroce.mjs` por el mismo motivo (ver
   su comentario en el propio fichero).

**Arreglado en `desbroce.mjs` (2026-09-13, mismo turno):** `4e` ahora acepta el aviso tanto
en forma de objeto (`{code}`, motor en proceso) como de string (HTTP) — reverificado por
HTTP contra la función ya desplegada: **19 PASA/0 FALLA/3 NO PROBADO**. **No se ha tocado
ningún runner de arbustos, cesped, palmeras ni setos** — corresponde a cada auditoría
arreglar el suyo, igual que ya se dijo para el `serviceId` fantasma más arriba.

---

## 5. Estado de las auditorías

| Rama | Servicio | Estado |
|---|---|---|
| `auditoria/cesped` | Corte de césped | Fases 1-3 completas (2026-09-12). Corregidos los dos hallazgos propios: #2 (aviso de plausibilidad) y #1 (horas ligadas al % configurado, no a `getDurationMultiplier`). T2/T4/T5/T6/T7 anotados aquí, sin tocar — esperan ronda transversal. Runner en verde, listo para PR |
| `auditoria/setos` | Poda de setos | Fases 1-3 completas (2026-09-11). Corregidos los 3 hallazgos propios: #1 horas ligadas al `condition_surcharges` real del jardinero en vez del multiplicador fijo `getDurationMultiplier` (mismo patrón que césped #1); #2 `specialist_enabled` se infiere también desde `pricing_matrix['4-6m'] > 0`, no solo desde el flag explícito o el legacy `selected_categories` — el autoguardado del primer render ya no vacía la banda 4-6m (reproducido y corregido en vivo, con evidencia SQL antes/después); #3 nuevo aviso `hedge_length_implausible` (>200 ml) en el flujo de fotos, mismo patrón que `lawn_area_implausible` de césped. Ninguno era transversal — evaluación explícita en la nota de arriba, con dos avisos (no hallazgos) para desbroce/arbustos (mismo patrón #1 sin corregir en sus bloques) y para las seis auditorías restantes (revisar su propio configurador por el mecanismo que causó #2). Runner en verde: **35 PASA / 0 FALLA / 1 NO PROBADO, verificado por HTTP contra `booking-authority` ya desplegado** (transversal T7, no de setos). `tsc` 172→172 (sin errores nuevos), `vitest` 434/434. serviceId real `7092ee0e-1779-45cf-bc2d-5235a757c618` (el de `references/servicios.md` era fantasma). **Fusionado y desplegado (2026-09-11): PR #22 (fix) y #23 (ajuste del runner al contrato de `warnings` por HTTP — el motor en local expone `{code,message}`, la API los aplana a `message` string; no era un fallo del fix #3, solo de cómo lo comprobaba el runner) — merge, `supabase functions deploy booking-authority --use-api` y actualización del entorno local compartido hechos por el chat (el usuario estaba remoto sin poder hacerlo).** Informe: `docs/audit/2026-09-11-setos/REPORT.md` §9. Servicio en producción — **estado: GO**. |
| `auditoria/arboles` | Poda de árboles | Fases 1-3 completas (2026-09-11). Veredicto GO. Corregidos los 4 hallazgos propios: tope de `quantity` (20, manual + UI), texto del configurador de dificultad alta, y 2 ficheros de código muerto. Runner en verde, 434/434 tests, 172 errores de tipo (≤173 de main). T4/T5/T6/T9/T10 anotados aquí, sin tocar — esperan ronda transversal. Listo para PR |
| `auditoria/palmeras` | Poda de palmeras | Fases 1-3 completas (2026-09-11/12). **Veredicto: GO.** Los 4 hallazgos corregidos y verificados: #4 (RPC `propose_booking_price_change` leía `pricing_context->'palm_groups'`/`is_terminal_open_range`, la ruta real es `pricing_context.quote_snapshot.metadata.pricingContext.palmGroups[].isTerminalOpenRange` — corregido en `20260912100000_fix_palm_price_change_pricing_context_path.sql` y verificado con una llamada RPC autenticada real: `{"status":"pending_client_acceptance",...}`); #1a-b (`calculatePalmHoursFromConfig` ahora multiplica por `trunkMult` y suma `PALM_PHYTOSANITARY_TIME_HOURS×quantity`); #2 (aviso `palm_quantity_implausible` a partir de 20 palmeras + tope de UI en `handlePalmQuantityChange` igualado al manual, 50); #3 (migración de `selected_species` en `PalmPricingConfigurator.tsx` ahora también detecta especies con precio en `height_prices`, verificado en vivo: las 6 especies aparecen activas y `additional_config.selected_species` en BD ya no queda en `[]`). serviceId real `8e5a99f5-5ab5-40c7-b4f3-a9272c08f47e`. Runner: **71 PASA / 0 FALLA / 0 NO PROBADO** en `READINESS_ENGINE=local`. `tsc` 172→172 (sin errores nuevos), `vitest` 434/434 (1 test de `bookingQuoteCore.test.ts` actualizado: el mismo escenario con tronco+fito ahora da 5h en vez de 4h, correctamente). Sin hallazgos transversales nuevos durante la corrección — las dos notas ya añadidas en Fase 2 (extensión de T1, segunda confirmación del patrón de autoguardado) siguen siendo las únicas. Informe: `docs/audit/2026-09-11-palmeras/REPORT.md` §9 (cierre de Fase 3). PR pendiente de abrir por el usuario. |
| `auditoria/arbustos` | Poda de plantas y arbustos | Fases 1-3 completas (2026-09-12). **Veredicto: GO.** Fase 2 halló 5 hallazgos, 2 bloqueantes: #1 el estado de las plantas que detecta la IA se pierde por completo en el camino del botón global "Analizar" (`DetailsPage.tsx:2385-2411`, sin `estado_plantas`/`state`) — existía un segundo camino correcto (`analyzeShrubGroup`/`adaptShrubAnalysisResult`), ambos botones coexisten en pantalla; #3 las horas usaban un multiplicador fijo (30/70 %) distinto del recargo real configurado (20/50 %), confirmado por ejecución (20 m² descuidado: 156€ correcto pero 3,5h en vez de 3,0h). Más 3 no bloqueantes: #2 `condition_surcharges` no configurable desde el panel del jardinero; #4 sin aviso de plausibilidad de superficie + asimetría 4x IA(500m²)/manual(2000m²); #5 desglose podía sumar más que el total cobrado con 2+ grupos (291€ cobrado vs 292€ en líneas). Los 5 corregidos y reverificados en Fase 3: #1 el botón global ya lee `estado_plantas` (tipado nuevo en `AITask`); #2 nueva sección "Recargo por Estado" en `ShrubPricingConfigurator.tsx` + campo en el tipo (confirmado en vivo, sin autoguardado espurio); #3 las horas ya usan el mismo `resolveSurchargePercent` que el precio (156€/**3h**, 225€/**4,5h**); #4 nuevo aviso `shrub_area_implausible` (>500m², el tope manual sigue en 2000 sin cambios); #5 `buildShrubBreakdown` reparte el redondeo entre líneas (215+76=291€=totalPrice). Verificado: runner **18 PASA/0 FALLA/1 NO PROBADO**, `tsc` 172→172 (sin nuevos, tras corregir 1 error real de tipo detectado en el propio proceso), `vitest` 437/437. Ciclo de vida completo verificado con pago real (antes de los fixes, sin relación con ellos): reserva→autorización→aceptación del jardinero (captura, Stripe `succeeded`)→cancelación del cliente→reembolso real (`re_3UEpNG2MwFyGXuB70huubLjy`). T6/T7/T9/T4 reproducidos en vivo (no nuevos; T4 con evidencia propia — ver su entrada en §3.2). Ninguno de los 5 hallazgos era transversal — los 5 fixes quedaron contenidos en ficheros/bloques propios de arbustos. **Segunda ronda de verificación en vivo (a petición del usuario, §10 del informe):** confirmado que el fix #3 no se refleja todavía en `ProvidersPage` porque esa pantalla llama a `booking-authority` desplegado desde el checkout de referencia (no este worktree) — el fix está probado y correcto en proceso (`READINESS_ENGINE=local`), pendiente de verse en la web hasta el redespliegue tras el merge; el hallazgo #1 sigue sin poder probarse con una clasificación real de Gemini porque este entorno local no tiene `GOOGLE_API_KEY` configurada (confirmado con una llamada HTTP real a `ai-pricing-estimator`, no por falta de intento). Informe: `docs/audit/2026-09-12-arbustos/REPORT.md`. PR pendiente de abrir por el usuario. |
| `auditoria/desbroce` | Desbroce de malas hierbas | Fases 1-3 completas, dos rondas de corrección (2026-09-12). **Veredicto: GO.** Fase 2 halló 2 hallazgos propios bloqueantes y 2 no bloqueantes; los 4 corregidos y reverificados. **Primera ronda:** #1 el único camino real del cliente (editor ad-hoc en `DetailsPage.tsx`) nunca fijaba `dataInputMode` → parcheado fijándolo en `commitSimplePhotoCollectionPatch`; #2 las horas usaban `getDurationMultiplier` fijo (30%/70%) en vez del recargo real (20%/50%) → corregido con el mismo patrón que césped/setos/arbustos, función eliminada por quedar huérfana; #3 sin aviso de plausibilidad → añadido `weeding_area_implausible` (umbral 2000m²); #4 (herbicida sin tiempo estimado) se dejó abierto pendiente de decisión de negocio. **Segunda ronda, a petición explícita del usuario:** #4 corregido — el herbicida suma el mismo % de tiempo que de precio (`1+precio_herbicida_m2/precio_desbroce_m2`); y #1 se corrigió más a fondo de lo que hacía falta para pasar el runner — en vez de quedarse con el parche mínimo, se retiró el editor ad-hoc por completo y desbroce pasa a usar el mismo `ManualEntryWizard` genérico que los otros 6 servicios (`isManualActive` ahora es `isManualOnlyActive || (...)`, deliberadamente independiente de `manualFlowEnabled` porque ese flag vale `false` por defecto en `.env.example` y un servicio sin fotos no tiene nada que esa alternativa desactive). 334 líneas netas menos en `DetailsPage.tsx`, `src/utils/weedingPersistence.ts` eliminado por quedar sin consumidores. Verificado en vivo con una reserva y pago reales de principio a fin en cada ronda (dos reservas distintas, dos pagos con tarjeta de test completados): tras la segunda ronda, el panel del jardinero muestra correctamente "Datos introducidos manualmente por el cliente · no verificados por IA" (ya no "Analizado por IA (fotos)"), y `booking_manual_declarations` guarda el registro de auditoría que antes faltaba. `serviceId` real `d946c65f-c588-4103-baca-0317667f04aa` (el de `references/servicios.md` y el runner heredado eran fantasma). Runner **19 PASA/0 FALLA/3 NO PROBADO**, `tsc` **171** (172 de baseline → 171, una menos gracias a un error de tipos preexistente que se eliminó de paso), `vitest` 437/437. T1/T2/T6/T7/T9/T11 reproducidos con evidencia fresca durante la Fase 2, ninguno tocado (transversales). **Corrección a T12**: no se reproduce en `WeedingPricingConfigurator.tsx` (falso positivo, ver §3.2). Autoguardado en primer render: descartado para este configurador. Cambio de precio/cancelación/reseña/volver-a-reservar específicos de desbroce quedan NO PROBADO (mecanismo transversal ya verificado en otros servicios). Se consideró y se **revirtió** una defensa adicional en `booking-authority/index.ts` (validar siempre que haya `weedingZones`, no solo con `dataInputMode==='manual'`): es un fichero compartido y desplegado que `READINESS_ENGINE=local` no ejercita, así que no se pudo verificar sin desplegar a la instancia compartida — queda como sugerencia en el informe, no como código sin probar. Informe: `docs/audit/2026-09-12-desbroce/REPORT.md`. **Nota de entorno:** esta sesión empezó en el worktree de fitosanitarios y se redirigió a desbroce a petición del usuario; `preview_start {name}` intentó arrancar el dev server dos veces desde el worktree equivocado antes de detectarlo — el detalle completo está en la cabecera del informe. PR [#28](https://github.com/mjgardenproject-dev/GarSer/pull/28) abierta, con las dos rondas de corrección como commits separados, a petición explícita del usuario. |
| `auditoria/fitosanitarios` | Servicios fitosanitarios | **Fases 1-3 completas (2026-09-12). Veredicto: GO**, con una condición de despliegue (ver abajo). Fase 2 halló 13 problemas —3 bloqueantes de caja— y la corrección destapó 2 más, los 15 corregidos y verificados. El cambio de fondo: los caminos manual y de fotos compartían servicio pero **no tabla de precios**, y la del manual mapeaba el precio por tipo de producto cuando las tarifas reales están por intención, así que **todo tratamiento preventivo se facturaba a tarifa curativa** (+33 % a +67 % según el ámbito) y el curativo de insectos+hongos **se cobraba dos veces** (460 € frente a 230 €). Ahora hay una sola tabla, `detailed_pricing`, y la paridad IA↔manual la garantiza el diseño en vez de una comprobación. Además: las horas de un tratamiento de plantas por fotos eran 0 (el bloque de horas omitía la métrica que la elegibilidad sí exigía); el configurador escondía sus 25+ tarifas por comparar `pricing_method` en crudo (T12); el formulario no preguntaba el porte ni ofrecía endoterapia, dejando 12 tarifas sin poder facturarse; y **cada guardado del configurador disparaba el precio de la endoterapia de 65 a 160 €/tronco** (hallazgo nuevo #14). Regla de negocio fijada por el usuario en esta fase: *un combo son dos tratamientos facturables que se suman, sin porcentaje extra* — el recargo de combo se ha retirado del motor y del configurador. Verificado: runner **78 PASA / 0 FALLA / 1 NO PROBADO por HTTP** contra una instancia de Supabase levantada desde el propio worktree (era 34/18), `vitest` **437/437**, `tsc` **172** (main arrastra 173: uno menos, ninguno nuevo). Lo único que queda NO PROBADO es la puerta de licencia, que es T1 y no es del motor. En vivo, con la web cotizando ya contra el motor corregido: césped 1000 m² preventivo **120 €** (antes 200), curativo insectos+hongos **400 €** = 2 × 200 sin recargo (antes 460), 10 árboles grandes **400 €** (antes 250 — ese porte ni siquiera era declarable), configurador de 9 a 35 campos, cadena configurador→BD→motor comprobada, y **pago real completo de principio a fin** (`1fc77a3a-…`, PaymentIntent `pi_3UEoby2…`: `requires_capture` → **`succeeded`**, 5000 cts capturados al aceptar el profesional). **Condición de despliegue: el orden importa más que de costumbre** — el front nuevo declara `sizeBand`/`wantsEndotherapy`, que el motor viejo interpreta mal (medido: 10 árboles grandes → 250 € con el motor de `main`, 400 € con el corregido), así que `booking-authority` debe redesplegarse ANTES que el front. T12 anotado en §3.2 sin tocar; T13 se retiró tras comprobarse que era un falso positivo. Informe: `docs/audit/2026-09-12-fitosanitarios/REPORT.md`. |
