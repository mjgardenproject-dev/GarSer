# Sistema de análisis y reserva — Servicios Fitosanitarios

Documento de diseño del flujo IA end-to-end (Gemini 2.5 Flash) para **Servicios
fitosanitarios** y sus subservicios. Los 5 entregables siguen las plantillas de la skill
`garser-ai-analysis-flows`. El código vive en:

- Prompt: `supabase/functions/ai-pricing-estimator/new_prompts.ts` (módulo `'Servicios fitosanitarios'`)
- Contrato: `src/shared/analysisV2.ts` (`PhytosanitaryServiceMetrics`) + `EMPTY_PHYTOSANITARY_ANALYSIS_METRICS`
- Adaptador: `src/pages/reserva/detailsPageAdapters.ts` (`adaptPhytosanitaryAnalysisResult`, conversión endoterapia)
- UI: `src/pages/reserva/DetailsPage.tsx` (`syncPhytosanitaryTreatmentFields`, `getPhytosanitaryValidation`, `updatePhytosanitaryMetricItem`)
- Entrada manual: survey `phytosanitary` en `manualEntrySchema.ts` (ya rellenaba los campos canónicos)
- Motor: `src/shared/bookingQuoteCore.ts` (`calculatePhytosanitaryQuote`)

---

## 0. Bugs críticos corregidos en esta revisión

1. **Curativo cobrado como preventivo / eco y combo jamás aplicados (flujo fotos).** El
   motor deriva los tratamientos de `intent`/`curativeTarget`/`productPreference`, pero
   el flujo de fotos solo guardaba `requestedTreatment`+`wantsEco`+`type` → TODA zona
   de fotos caía al default `preventive+insecticida`: la columna curativa (más cara)
   nunca se usaba, el modificador eco (+%) nunca se aplicaba y el recargo combo tampoco.
   **Fix doble**: la UI ahora sincroniza los campos canónicos
   (`syncPhytosanitaryTreatmentFields`) y el motor tiene fallback de derivación desde
   `type` para zonas/snapshots antiguos (fungicida→curativo hongos, insecticida+fungicida
   →curativo ambos, `ecologico_preventivo` en type→producto eco, endoterapia→endoterapia).
2. **Endoterapia insolicitable (subservicio muerto).** No era opción en ningún flujo, el
   prompt no devuelve troncos y el motor solo la cobraba si las métricas ya la traían.
   **Fix**: opción "Endoterapia (inyección en el tronco, para picudo)" cuando el alcance
   incluye Palmeras; el adaptador trasvasa las palmeras detectadas a
   `palmeras_endoterapia_troncos_ud`; el motor cobra `precio_unico × troncos` sin
   arrastrar la ducha base (guard `isEndoOnlyRequest`).
3. **Cantidades de la IA solo borrables.** Ahora cada métrica detectada es un input
   numérico editable (+ borrar), con re-suma del área.
4. **Eco en curativos**: el % eco es preferencia de producto y ahora aplica también en
   curativos ecológicos, sin convertirse en tratamiento extra (no altera el conteo combo).
5. **Prompt sin definiciones de tamaños**: los cortes que seleccionan la tarifa del
   jardinero (palmeras 3,5/8 m…) no se le decían a la IA. Añadidos junto con
   procedimiento, escala y rangos plausibles.

---

## 1. Flujo de análisis documentado (por subservicio)

### Variables que produce el flujo → motor
(fuente: `garser-pricing-rules` §6.7 / §7.7)

| Variable | Fuente | Verificación |
|---|---|---|
| `phytosanitaryZones[].scope` → `affectedType` | Cliente (chips de alcance) | Estructura el prompt (todo fuera de alcance = 0) |
| `intent` (`preventive`\|`curative`) | **Cliente** (chips nuevos) | Selecciona la columna de tarifa |
| `curativeTarget` (`insects`\|`fungus`\|`both`) | **Cliente** (select "¿Qué quieres combatir?", solo curativo) | `both` activa el recargo combo |
| `productPreference` (`chemical`\|`ecological`) | **Cliente** (checkbox eco) | Activa el modificador eco (+%) |
| `analysisMetrics.*` (cantidades por elemento) | IA (fotos) | **Cliente corrige en inputs numéricos** o borra |
| `type` (string legacy) | Derivado (`syncPhytosanitaryTreatmentFields`) | Fallback de derivación del motor |

### Subservicio: Césped (`cesped_m2` × `detailed_pricing.cesped.preventivo/curativo`)
- Fotos: césped completo con bordes visibles. IA mide m² (política igual a Corte de Césped).
- Plausibilidad ≤2.000 m². Cliente corrige los m² en el input de la card.

### Subservicio: Plantas bajas (`plantas_superficie_calculada_m2` + `plantas_tamano_dominante`)
- Política de área bruta del macizo. Tamaño dominante: pequeñas <0,5 m · medianas
  0,5–1,5 m · grandes 1,5–2 m (cortes del configurador). Plausibilidad ≤500 m².
- Fallback sin métricas: `superficies_plantas.hasta_100m2/mas_de_100m2` por `area`.

### Subservicio: Setos (`seto_bajo_medio_ml` / `seto_alto_ml`)
- Bajo/medio <2,5 m · alto 2,5–5 m (cortes del configurador). Plausibilidad ≤200 ml.
- Fallback: pregunta `aboveTwoMeters` + matrices `setos.hasta_2m/mas_de_2m`.

### Subservicio: Árboles (`arboles_peq/med/gran_ud`)
- Pequeño <3 m · mediano 3–6 m · grande >6 m; se ignoran árboles <2 m. Plausibilidad ≤50 ud.
- Fallback: `aboveThreeMeters` + matrices `arboles.hasta_3m/mas_de_3m`.

### Subservicio: Palmeras — ducha (`palmeras_ducha_peq/med/alta_ud`)
- Pequeña <3,5 m · mediana 3,5–8 m · alta >8 m (cortes del configurador). Plausibilidad ≤30 ud.
- Cirugía (`palmeras_cirugia_ud`): solo si hay colapso de corona o galerías visibles.

### Subservicio: Palmeras — endoterapia (`palmeras_endoterapia_troncos_ud` × `precio_unico`)
- El cliente la solicita explícitamente (select, solo con alcance Palmeras).
- La IA cuenta palmeras; el adaptador convierte el conteo a troncos; el motor cobra
  `precio_unico × troncos` sin ducha base. Eco no aplica (aviso existente).

### Fases
1. **Input**: alcance (chips multi) → intención preventivo/curativo (chips) → si
   curativo: qué combatir (insectos/hongos/ambos/endoterapia si palmeras) → opción eco →
   fotos (1–5 por zona).
2. **Pre-validación**: `getPhytosanitaryValidation` exige alcance, intención, objetivo
   (si curativo), vegetación y 1–5 fotos seleccionadas; warning eco+endoterapia.
3. **Gemini**: una llamada por zona con `phytosanitary_scopes` (todo fuera de alcance = 0).
4. **Post-validación**: métricas saneadas a números ≥0; observaciones universales.
5. **Confirmación**: cada cantidad detectada es un input editable + borrar; observaciones
   descartables una a una.
6. **Handoff**: zona con campos canónicos + `analysisMetrics` → `calculatePhytosanitaryQuote`
   (subtotal por elemento × ecoMult × comboMult, mínimo del jardinero).

---

## 2. System prompt Gemini 2.5 Flash

Config: `gemini-2.5-flash` · temperature 0 · topP 1 · topK 1 ·
`response_mime_type: application/json` · reintentos: 3 con backoff solo en 429.

Añadidos de esta revisión sobre el módulo existente:
- **Procedimiento**: deduplicar con anclas → escala (persona/puerta/valla/baldosa) →
  cuantificar por familia dentro del alcance → clasificar tamaños con los cortes de
  abajo → ante duda, reportar el valor MENOR plausible + `AMBIGUOUS_COUNT`/`AMBIGUOUS_SIZE`.
- **SIZE DEFINITIONS** (los mismos cortes que el configurador del jardinero): setos
  <2,5 m / 2,5–5 m · palmeras <3,5 / 3,5–8 / >8 m · árboles <3 / 3–6 / >6 m · plantas
  <0,5 / 0,5–1,5 / 1,5–2 m.
- **PLAUSIBLE RANGES**: césped ≤2.000 m², plantas ≤500 m², setos ≤200 ml, palmeras ≤30
  ud, árboles ≤50 ud; por encima → reportar el máximo del rango + `AMBIGUOUS_SIZE`.

## 3. JSON schema + ejemplo

Schema sin cambios (métricas canónicas + `observaciones_ia`). Ejemplo (alcance palmeras):

```json
{
  "razonamiento_transversal": { "medicion_principal": "Alturas contra la valla de 1,2 m", "deduplicacion": "3 palmeras distintas entre 4 fotos", "calidad": "nivel 1", "conflictos": "ninguno" },
  "metricas_fitosanitarias": {
    "cesped_m2": 0, "seto_bajo_medio_ml": 0, "seto_alto_ml": 0,
    "palmeras_ducha_peq_ud": 1, "palmeras_ducha_med_ud": 2, "palmeras_ducha_alta_ud": 0,
    "palmeras_cirugia_ud": 0, "arboles_peq_ud": 0, "arboles_med_ud": 0, "arboles_gran_ud": 0,
    "herbicida_poca_densidad_m2": 0, "herbicida_mucha_densidad_m2": 0,
    "plantas_superficie_calculada_m2": 0, "plantas_tamano_dominante": null
  },
  "observaciones_ia": []
}
```
> Si el cliente pidió endoterapia, el adaptador convierte 1+2 palmeras →
> `palmeras_endoterapia_troncos_ud: 3` (duchas a 0).

---

## 4. Matriz de errores

| # | Fallo | Capa | Detección | Acción | Mensaje |
|---|---|---|---|---|---|
| E01 | Sin alcance | Pre-validación | `scope` vacío | Bloquear análisis | "Selecciona el alcance del tratamiento." |
| E02 | Sin intención | Pre-validación | `intent` vacío | Bloquear análisis | "Indica si el tratamiento es preventivo o curativo." |
| E03 | Curativo sin objetivo | Pre-validación | `curative` sin `requestedTreatment` | Bloquear análisis | "Indica qué quieres combatir (insectos, hongos o ambos)." |
| E04 | Fotos fuera de rango | Pre-validación | <1 o >5 seleccionadas | Bloquear análisis | Mensajes existentes |
| E05 | Eco + endoterapia | Pre-validación | ambos activos | Warning (eco se desactiva) | "La opción ecológica no aplica cuando se solicita endoterapia." |
| E06 | Nada detectado | Gemini | métricas a 0 + `ELEMENTS_NOT_DETECTED` | `AnalysisFailedCard` + reanalizar; alternativa manual | "La IA no detectó elementos con cantidad." |
| E07 | Conteo/medida dudosa | Gemini | `AMBIGUOUS_COUNT`/`AMBIGUOUS_SIZE` | Valor conservador + observación visible; cliente corrige en el input | Observaciones traducidas |
| E08 | Cantidad IA incorrecta | Confirmación | — | **Input numérico editable por métrica** + borrar | — |
| E09 | Tratamiento/tarifa sin configurar | Motor | `tratamientos_activos` vacíos o tarifas 0 | Excluir jardinero (`missing_treatment_config`/`missing_pricing_config`) | El cliente solo ve jardineros compatibles |
| E10 | Yield faltante para la familia | Motor | `getRequestedPhytosanitaryYieldKeys` | Excluir jardinero (`missing_yield_config`) | — |
| E11 | Fallo técnico | Edge | HTTP ≠ 200 / parse | 3 intentos backoff en 429; después manual | "No pudimos completar el análisis…" |
| E12 | Zona legacy sin campos canónicos | Motor | `intent` undefined | Fallback de derivación desde `type` (fungicida/combo/eco/endoterapia inequívocos; insecticida solo → preventivo, statu quo) | — |

Nota: `herbicida_poca/mucha_densidad_m2` no alimentan `detailed_pricing` — el control de
malas hierbas se contrata vía el servicio Desbroce (herbicida opt-in). Se mantienen en el
contrato por compatibilidad.

---

## 5. Guía del cliente (Details Page)

Título in-app: "Servicios fitosanitarios" — "Configura cada zona con tipo de vegetación
+ tratamiento y sube fotos claras para analizar."

**Antes de las fotos, responde 3 preguntas por zona:**
1. **Alcance**: qué vegetación quieres tratar (puedes marcar varias o todo el jardín).
2. **¿Preventivo o curativo?** Preventivo = no hay plaga, quieres proteger. Curativo =
   hay una plaga u hongo activo (y eliges qué combatir: insectos, hongos o ambos; en
   palmeras también endoterapia contra el picudo).
3. **¿Producto ecológico?** Recomendado en zonas con niños o mascotas (pequeño recargo).

**📸 Las fotos (1–5 por zona):**
- La vegetación del alcance completa en el encuadre, de día y sin contraluz.
- Si hay daños visibles (hojas comidas, hongos, galerías), añade una foto de detalle.
- Truco de escala: una persona o una puerta cerca ayuda a clasificar los tamaños, que
  influyen en el precio.

**✍️ Después del análisis**
Verás cada cantidad detectada (palmeras por tamaño, metros de seto, m² de césped…) en
campos editables: corrige o elimina lo que no encaje antes de ver los precios. Sin
visitas previas ni sorpresas.
