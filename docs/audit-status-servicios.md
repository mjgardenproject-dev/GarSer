# Estado de Auditoría — Servicios de Jardinería

**Actualizado:** 2026-07-08  
**Objetivo:** Sistema de análisis IA end-to-end (Gemini 2.5 Flash) para todos los servicios, con corrección de bugs de pricing y UX.

---

## ✅ COMPLETADOS (Ready for Testing)

### 1. Poda de Palmeras
**Status:** ✅ Implementado, desplegado, testeado (333/333 tests pass)

| Aspecto | Detalle |
|---|---|
| **Prompt Gemini** | Procedimiento de medición, especies catalogadas, estado operativo, confidences + referencia de escala |
| **Post-validación** | Altura >10m → needs_review; merge conserva peor nivel_analisis |
| **UI DetailsPage** | Card editable: altura (input), especie (select), estado (chips + recargo) |
| **Entrada manual** | Wizard con paso de estado nuevo |
| **Motor (bookingQuoteCore)** | Recargos `condition_surcharges` por estado |
| **Docs** | [analisis-ia-palmeras.md](./analisis-ia-palmeras.md) |
| **Bug corregido** | Entrada manual no preguntaba estado → recargos nunca se aplicaban |
| **PR** | [#7](https://github.com/mjgardenproject-dev/GarSer/pull/7) |

**Testing checklist:** [testing-plan-palmeras-arboles-arbustos.md § Palmeras](./testing-plan-palmeras-arboles-arbustos.md#2-poda-de-palmeras)

---

### 2. Poda de Árboles
**Status:** ✅ Implementado, desplegado, testeado (333/333 tests pass)

| Aspecto | Detalle |
|---|---|
| **Prompt Gemini** | Altura TOTAL, bandas (small/medium/large/over_9), confidences + escala |
| **Post-validación** | Altura >40m → nivel 2 + AMBIGUOUS_SIZE; dificultad_alta forzada a false |
| **UI DetailsPage** | Card editable: altura (input), tamaño (select), **tipo de poda (chips)**, cantidad (stepper) |
| **Entrada manual** | Wizard con tipo y cantidad (pero tipo era fijo, ahora editable) |
| **Motor (treePruningPricing)** | Multiplica precio y horas por quantity |
| **Docs** | [analisis-ia-arboles.md](./analisis-ia-arboles.md) |
| **Bug crítico corregido** | `pruningType` fijado a "estructural" sin preguntar → tarifa "formación" nunca se aplicaba → **FIX: chips siempre visibles y editables** |
| **PR** | [#7](https://github.com/mjgardenproject-dev/GarSer/pull/7) |

**Testing checklist:** [testing-plan-palmeras-arboles-arbustos.md § Árboles](./testing-plan-palmeras-arboles-arbustos.md#2-poda-de-árboles)

---

### 3. Poda de Plantas y Arbustos
**Status:** ✅ Implementado, desplegado, testeado (333/333 tests pass)

| Aspecto | Detalle |
|---|---|
| **Prompt Gemini** | Tamaño (rodilla/pecho/cabeza), estado (normal/descuidado/muy_descuidado), superficie, confidences |
| **Post-validación** | >500 m² → nivel 2 + AMBIGUOUS_SIZE; worstShrubState al fusionar por tamaño |
| **UI DetailsPage** | Card editable: superficie (input), tamaño (select), **estado (chips + aviso recargo)** |
| **Entrada manual** | Wizard con paso de estado nuevo |
| **Motor (bookingQuoteCore)** | `condition_surcharges.media/alta` aplicados según estado |
| **Docs** | [analisis-ia-arbustos.md](./analisis-ia-arbustos.md) |
| **Bug CRÍTICO corregido** | Campo `state` inexistente en todo el flujo → `condition_surcharges` jamás se aplicaban → **FIX: estado en IA, UI, manual, tipos; confirmación obligatoria en chips** |
| **PR** | [#7](https://github.com/mjgardenproject-dev/GarSer/pull/7) |

**Testing checklist:** [testing-plan-palmeras-arboles-arbustos.md § Arbustos](./testing-plan-palmeras-arboles-arbustos.md#3-poda-de-plantas-y-arbustos)

---

## ⏳ PENDIENTES (Next Priority)

### 4. Poda de Setos (HIGH PRIORITY — 2 caras obligatorias)
**Status:** ⏳ Auditoría pendiente

**Variantes:** 
- Tamaño: 0-2m, 2-4m, 4-6m (3 rangos, 2 obligatorios mínimo)
- Caras: 1 cara (simple), 2 caras (FACE_A, FACE_B), más caras (complejo)
- Estado: normal / media / alta (recargos condition_surcharges)

**Bugs esperados a revisar:**
- [ ] Estado observable en fotos: ¿se extrae? ¿se propone o siempre default?
- [ ] Caras: ¿flujo de etiquetado es claro en UI?
- [ ] Tamaño: ¿el cliente puede cambiar altura propuesta?
- [ ] Merge multi-foto: ¿se deduplican bien caras distintas?
- [ ] Entrada manual: ¿pregunta estado y caras?

---

### 5. Corte de Césped (HIGH PRIORITY — servicio más frecuente)
**Status:** ⏳ Auditoría pendiente

**Variantes:**
- Método: per_quantity (€/m²) o per_hour (€/h)
- Estado: normal / descuidado / muy descuidado (recargos condition_surcharges)
- Extras: retirada de restos (waste_removal.percentage)

**Bugs esperados a revisar:**
- [ ] Estado: ¿se propone por IA o cliente siempre elige?
- [ ] Acceso UI: ¿es evidente cómo cambiar estado/retirada restos?
- [ ] Entrada manual: ¿pregunta estado?
- [ ] Foto única: ¿suficiente o se pide más?

---

### 6. Desbroce / Eliminación de Malas Hierbas (MEDIUM PRIORITY)
**Status:** ⏳ Auditoría pendiente

**Variantes:**
- Dificultad: normal / dificultad_media / dificultad_alta (recargos suplementos)
- Herbicida: sí/no (toggle → tarifa extra)
- Retirada de restos: sí/no

**Bugs esperados a revisar:**
- [ ] Dificultad: ¿cómo se estima desde foto? ¿cliente puede editar?
- [ ] Herbicida: ¿se pregunta solo si se aplica o siempre?
- [ ] Entrada manual: ¿flujo claro?

---

### 7. Servicios Fitosanitarios (MEDIUM PRIORITY — más complejo)
**Status:** ⏳ Auditoría pendiente

**Variantes:**
- Vegetación afectada: Césped, Árboles, Setos, Palmeras, Plantas bajas
- Intención: preventiva / curativa (+ target: insects/fungus/both)
- Tratamiento: químico / ecológico
- Modificadores: combo multi-tratamiento, end

erapia (palmeras)

**Bugs esperados a revisar:**
- [ ] Multi-zona en una llamada: ¿merge de resultados es correcto?
- [ ] Matriz de precios `superficies_plantas` / `setos` / `arboles` / `palmeras`: ¿todas se usan?
- [ ] Tarifas por tratamiento: ¿se aplican los recargos eco/combo?
- [ ] Entrada manual: ¿es inteligible el wizard de 4+ steps?

---

## 📊 Tabla Resumen

| Servicio | Status | Bug Crítico | Test | Docs | PR |
|---|---|---|---|---|---|
| Palmeras | ✅ | Estado no en manual | ✅ | [✅](./analisis-ia-palmeras.md) | [#7](https://github.com/mjgardenproject-dev/GarSer/pull/7) |
| Árboles | ✅ | pruningType fijo "estructural" | ✅ | [✅](./analisis-ia-arboles.md) | [#7](https://github.com/mjgardenproject-dev/GarSer/pull/7) |
| Arbustos | ✅ | state nunca existió en flujo | ✅ | [✅](./analisis-ia-arbustos.md) | [#7](https://github.com/mjgardenproject-dev/GarSer/pull/7) |
| **Setos** | ⏳ | TBD | ⏳ | ⏳ | ⏳ |
| **Césped** | ⏳ | TBD | ⏳ | ⏳ | ⏳ |
| **Desbroce** | ⏳ | TBD | ⏳ | ⏳ | ⏳ |
| **Fitosanitarios** | ⏳ | TBD | ⏳ | ⏳ | ⏳ |

---

## Checklist de Merge (Antes de pasar a Setos)

Después de testing:

- [ ] `npm test` — 333/333 pass
- [ ] `tsc --noEmit` — clean
- [ ] Edge function `ai-pricing-estimator` desplegado
- [ ] Testing manual: palmeras (golden path + edge cases)
- [ ] Testing manual: árboles (golden path + edge cases, **critical: tipo de poda editable**)
- [ ] Testing manual: arbustos (golden path + edge cases, **critical: recargo por estado**)
- [ ] PR review y merge a `main`
- [ ] ✅ Pasar a auditar Setos

---

## Notas de Implementación

### Patrón de Auditoría (Aplicado a 3 servicios, Repetible para 4 restantes)

Para cada servicio:
1. **Leer reglas de pricing** en skill `garser-pricing-rules` → variables del motor
2. **Auditar prompt** en `new_prompts.ts` → ¿extrae todas las variables?
3. **Auditar post-validación** en `index.ts` → ¿saneamiento y merge correctos?
4. **Auditar contrato** en `analysisV2.ts` → ¿tipos permiten todas las variables?
5. **Auditar adaptador** en `detailsPageAdapters.ts` → ¿mapeo correcto?
6. **Auditar UI** en `DetailsPage.tsx` → ¿editable, confirmable, con avisos de recargo?
7. **Auditar entrada manual** en `manualEntrySchema.ts` + `manualEntryBuilders.ts` → ¿completa?
8. **Escribir docs** en `docs/analisis-ia-[servicio].md` → matriz de errores, guía cliente
9. **Tests nuevos** → cobertura de recargos, confidences, edge cases
10. **Crear testing checklist** → golden path + edge cases + regresión

### Archivos Clave (Tocados en los 3 servicios)

**Edge function:**
- `supabase/functions/ai-pricing-estimator/index.ts` — post-validación (sanitizeTreeResult, normalizeShrubState, worstShrubState)
- `supabase/functions/ai-pricing-estimator/new_prompts.ts` — prompts por servicio
- `supabase/functions/ai-pricing-estimator/new_prompts.test.ts` — test de prompts

**Shared:**
- `src/shared/analysisV2.ts` — interfaces (TreeMetric, ShrubServiceMetrics, LegacyAiTask)
- `src/shared/bookingQuoteCore.ts` — motor de precios (recargos, horas, merge)
- `src/shared/bookingQuoteCore.test.ts` — test de recargos (árboles, arbustos)

**UI:**
- `src/pages/reserva/DetailsPage.tsx` — cards editables, guías, gates
- `src/pages/reserva/detailsPageAdapters.ts` — mapeo IA → UI

**Manual:**
- `src/shared/manualEntry/manualEntrySchema.ts` — surveys y opciones
- `src/shared/manualEntry/manualEntryValidation.ts` — validación de answers
- `src/pages/reserva/manualEntryBuilders.ts` — answer → booking payload

**Contexto:**
- `src/contexts/BookingContext.tsx` — types palmGroups, treeGroups, shrubGroups

---

## Próximos Pasos Después de Setos

1. **Césped** (más fotos, menos IA) → estado y retirada de restos
2. **Desbroce** → dificultad y herbicida
3. **Fitosanitarios** (más complejo) → multi-zona, matrices de tratamiento, combos
4. **Merge final** → PR a main con todos los servicios auditados
5. **Staging testing** → full E2E en ambiente de staging
6. **Deploy a producción** → rollout gradual o bang con monitoreo

