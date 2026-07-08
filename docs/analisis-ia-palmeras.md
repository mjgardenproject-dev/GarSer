# Sistema de análisis y reserva — Poda de Palmeras

Documento de diseño del flujo IA end-to-end (Gemini 2.5 Flash) para el servicio
**Poda de Palmeras**. Los 5 entregables siguen las plantillas de la skill
`garser-ai-analysis-flows`. El código implementado vive en:

- Prompt: `supabase/functions/ai-pricing-estimator/new_prompts.ts` (módulo `'Poda de palmeras'`)
- Post-validación y banding: `supabase/functions/ai-pricing-estimator/index.ts` (`calculatePalmEstimation`)
- SSOT bandas/especies: `src/domain/speciesBusinessRules.ts`
- Contrato: `src/shared/analysisV2.ts` (`PalmMetric`, `LegacyPalmResult`)
- UI de reserva: `src/pages/reserva/DetailsPage.tsx` (sección `isPalmService`)
- Motor de precios autoritativo: `src/domain/pricingEngine.ts` (`calculatePalmPriceEngine`) vía `buildAuthoritativeBookingQuote`

---

## 1. Flujo de análisis documentado

### Variables de precio que debe producir el análisis
(fuente: `garser-pricing-rules` §6.4 / §7.4 / §10.4)

| Variable del motor | Tipo | Fuente primaria | Fuente de verificación |
|---|---|---|---|
| `palmGroups[].species` | enum 6 especies canónicas (`PALM_CANONICAL_SPECIES`) | IA (foto) | Cliente confirma/corrige en select (obligatorio si confidence <0.8 o " o similar") |
| `palmGroups[].height` | banda por especie (`'0-4'`, `'4-10'`, `'>10'`…, según `PALM_SPECIES_HEIGHT_BANDS`) | IA (altura de tronco en m → banda en edge) | Cliente confirma/corrige en select (aviso si confidence <0.8) |
| `palmGroups[].quantity` | entero ≥1 | Cliente (stepper) | IA propone (`aiDetectedCount` + resumen), nunca infla sola |
| `palmGroups[].state` | enum `normal\|descuidado\|muy_descuidado` → `condition_surcharges` | IA propone | **Cliente confirma SIEMPRE** (chips editables + aviso de recargo) |
| `palmGroups[].hasPhytosanitary` | boolean → `config.phytosanitary` (€ fijo/ud) | Cliente (toggle, pre-activado por recomendación) | Solo especies con `hasPhytosanitary` (regla de especie) |
| `palmGroups[].hasTrunkPeeling` | boolean → `config.trunk_finish` (%) | Cliente (toggle) | Solo especies con `hasTrunkPeeling` |
| `palmGroups[].hasAccessDifficulty` | boolean → `config.access_difficulty` (%) | Cliente (pregunta explícita Sí/No) | Nunca la IA; no aplica en la banda mínima de la especie |
| `wasteRemoval` (global) | boolean → `waste_removal.percentage` (%) | Cliente | — |

La IA **nunca** devuelve precios ni activa recargos: extrae `especie`, `altura_m`,
`estado` propuesto y confidences; el precio lo calcula `buildAuthoritativeBookingQuote`
con la config del jardinero concreto (`height_prices` / `yield_units_per_hour`).

### Fase 1 — Input del cliente (Details Page)
**Fotos por grupo de palmeras (1–5, mínimo 1):**
- Palmera entera: desde la base del tronco hasta la corona, sin recortar la copa.
- Opcional: detalle de la corona (para el estado).
- Truco de escala: una persona/puerta/cubo junto a la palmera.
- Un grupo por cada combinación distinta de especie + altura + estado; si hay varias
  idénticas, una sola foto y el cliente confirma la cantidad después.

**Formulario:** ninguno antes del análisis (fricción mínima). Tras el análisis el cliente
confirma: cantidad, especie, banda de altura, estado, extras y pregunta de acceso.

### Fase 2 — Pre-validación (sin IA)
- Grupo sin fotos → botón "Analizar" deshabilitado + aviso "Añade al menos una foto".
- Máximo 5 fotos por grupo (límite del uploader y de `maxImages` del prompt).
- Validación de formato/tamaño en `bookingPhotoPipeline` (común a todos los servicios).

### Fase 3 — Análisis Gemini
- **Una llamada por grupo de palmeras** (`analyzePalmGroup`): aísla errores entre grupos.
- Config real de producción: `gemini-2.5-flash`, `temperature 0`, `topP 1`, `topK 1`,
  `response_mime_type: application/json` (settings deterministas compartidos
  `DETERMINISTIC_PROMPT_SETTINGS`).
- Entrada: backbone universal (dedup multi-foto, niveles de calidad, códigos de
  observación) + módulo específico de palmeras + imágenes indexadas.
- Salida: `palmas[]` con especie, confidences, altura de tronco (m), referencia de
  escala, estado y nivel de análisis (schema del entregable 3).

### Fase 4 — Post-validación y reconciliación (edge)
- Confidences saneadas a [0,1] (`clampConfidence`).
- Banding: `altura_m` → banda de la especie con `PALM_SPECIES_HEIGHT_BANDS` (SSOT).
  Especie no resuelta → buckets genéricos legacy (`0-5`, `5-12`, `12-20`, `20+`).
- Plausibilidad: `altura_m` > máximo por especie (`PALM_SPECIES_MAX_PLAUSIBLE_HEIGHT_M`)
  → `nivel_analisis` ≥ 2 + observación `AMBIGUOUS_SIZE` (no se rechaza, se pide revisión).
- Estado normalizado a enum estricto; sufijo " o similar" eliminado tras usarlo como
  señal de baja confianza.
- `nivel_analisis = 3` o especie "No detectada" → excluida del resumen; si no queda
  ninguna → modal "No se han detectado palmeras".

### Fase 5 — Confirmación del cliente (resumen editable)
- **Especie**: select con las 6 especies canónicas, preseleccionada la detectada.
  Aviso ámbar si `especie_confidence < 0.8` o la IA devolvió " o similar".
- **Banda de altura**: select con las bandas de la especie. Al cambiar de especie se
  re-mapea con la `altura_m` detectada (`mapPalmHeightToBand`). Aviso si
  `altura_confidence < 0.8` (sin referencia de escala clara).
- **Estado**: chips Normal / Descuidada / Muy descuidada, preseleccionado el propuesto.
  Si la IA propuso ≠ normal: aviso "puede aplicar un recargo del profesional: confírmalo
  o corrígelo" hasta que el cliente toque el control (`stateProposedByAI`).
- **Cantidad**: stepper; si la IA detectó >1 palmera se muestra el resumen
  (`aiDetectedCount` + `aiDetectedSummary`) y el cliente decide.
- **Extras**: fitosanitario (pre-recomendado, con confirmación para quitarlo) y
  cepillado de tronco, solo si la especie los soporta.
- **Acceso**: pregunta explícita Sí/No (nunca la IA); deshabilitada en banda mínima.

### Fase 6 — Handoff al motor de precios
Payload final → `buildAuthoritativeBookingQuote` (por jardinero, en ProvidersPage):
```json
{
  "palmGroups": [
    {
      "species": "Phoenix canariensis",
      "height": "4-10",
      "quantity": 2,
      "state": "descuidado",
      "hasPhytosanitary": true,
      "hasTrunkPeeling": false,
      "hasAccessDifficulty": false
    }
  ],
  "wasteRemoval": true
}
```
Cobertura parcial (especie/banda sin precio del jardinero) → `partial_palm_coverage`
→ ese jardinero queda excluido **solo para este trabajo**.

---

## 2. System prompt Gemini 2.5 Flash

### Configuración de la llamada (producción)
- model: `gemini-2.5-flash` (env `GEMINI_MODEL`)
- temperature: 0 · topP: 1 · topK: 1 (determinista, repetible)
- response_mime_type: `application/json`
- Reintentos: 3 con backoff exponencial solo en 429; errores → `reasons[]` técnicos.

El prompt se ensambla como `UNIVERSAL_BACKBONE` (reglas comunes: solo JSON, sin precios,
dedup multi-foto, niveles 1/2/3, códigos de observación cerrados) + módulo específico.
Contenido del módulo de palmeras (ver fuente en `new_prompts.ts`):

- **Objetivo**: detectar palmeras distintas del trabajo, deduplicar ángulos, medir
  altura de TRONCO, clasificar especie y estado, y reportar confidence por campo.
- **Procedimiento ordenado**: contar/deduplicar con anclas → localizar referencias de
  escala (persona 1,70 m, puerta 2 m, planta de casa 2,8–3 m, valla 1,2 m, cubo 1 m) →
  medir tronco desde el suelo hasta la BASE de la corona (excluye hojas) → identificar
  especie → clasificar estado → asignar confidences.
- **Rasgos por especie** (lista cerrada, nombres exactos): canariensis (tronco grueso
  "piña", copa densa pinnada), dactylifera (tronco esbelto gris-azulado, hijuelos),
  Washingtonia (tronco alto y fino, hoja palmada, faldón), Syagrus (tronco anillado
  liso, plumosa arqueada), Trachycarpus (tronco con fibra, hoja palmada pequeña),
  Roystonea (tronco columnar liso, capitel verde). Dudosa → sufijo " o similar" +
  `especie_confidence ≤ 0.5`. Prohibido inventar especies fuera de la lista.
- **Definiciones operativas de estado**: normal (<15% hojas secas, sin faldón),
  descuidado (anillo de hojas secas colgando hasta ~1 m de tronco, o dátiles/varas
  abundantes, o 2+ temporadas sin poda), muy descuidado (faldón denso >1 m, seco
  dominante o colapso parcial de copa).
- **Rangos plausibles de tronco por especie**: canariensis 0,5–20 · dactylifera 0,5–25 ·
  Washingtonia 0,5–30 · Syagrus 0,5–20 · Roystonea 0,5–25 · Trachycarpus 0,5–12.
  Fuera de rango → nivel 2/3 + `AMBIGUOUS_SIZE`, nunca forzar el valor.
- **Calibración de confidence**: ≥0.9 visible con referencia de escala nítida ·
  0.6–0.89 inferido con apoyo parcial · <0.6 suposición (el sistema pedirá confirmación).
  Sin referencia de escala, `altura_confidence` debe ser <0.9.

---

## 3. JSON schema de extracción + ejemplo

Shape exigido en el prompt (la sintaxis la garantiza `response_mime_type: application/json`;
la semántica, el prompt + la post-validación del edge):

```json
{
  "razonamiento_transversal": {
    "medicion_principal": "string",
    "deduplicacion": "string",
    "calidad": "string",
    "conflictos": "string"
  },
  "palmas": [
    {
      "indice_imagen": 0,
      "especie": "Phoenix canariensis | ... | Roystonea regia [ o similar]",
      "especie_confidence": 0.0,
      "altura_m": 0.0,
      "altura_confidence": 0.0,
      "referencia_escala": "string | null",
      "estado": "normal | descuidado | muy descuidado | null",
      "estado_confidence": 0.0,
      "nivel_analisis": 1,
      "observaciones": ["AMBIGUOUS_SIZE", "..."]
    }
  ]
}
```

El edge añade `altura` (banda de precio de la especie) a cada palmera antes de devolver.

**Ejemplo de respuesta válida** (2 palmeras, una con referencia de escala):

```json
{
  "razonamiento_transversal": {
    "medicion_principal": "Tronco medido contra la puerta del garaje (~2 m) visible en la imagen 0.",
    "deduplicacion": "Las imágenes 0 y 1 muestran la misma Washingtonia desde dos ángulos (misma valla y piscina); la imagen 2 muestra una segunda palmera distinta.",
    "calidad": "Imágenes nítidas con el tronco completo visible; nivel 1 para la primera, nivel 2 para la segunda por falta de referencia de escala.",
    "conflictos": "ninguno"
  },
  "palmas": [
    {
      "indice_imagen": 0,
      "especie": "Washingtonia robusta/filifera",
      "especie_confidence": 0.95,
      "altura_m": 9,
      "altura_confidence": 0.9,
      "referencia_escala": "puerta de garaje ≈ 2 m",
      "estado": "descuidado",
      "estado_confidence": 0.85,
      "nivel_analisis": 1,
      "observaciones": null
    },
    {
      "indice_imagen": 2,
      "especie": "Trachycarpus fortunei o similar",
      "especie_confidence": 0.55,
      "altura_m": 2.5,
      "altura_confidence": 0.65,
      "referencia_escala": null,
      "estado": "normal",
      "estado_confidence": 0.8,
      "nivel_analisis": 2,
      "observaciones": ["AMBIGUOUS_SIZE"]
    }
  ]
}
```

---

## 4. Matriz de errores

| # | Fallo | Capa | Regla de detección | Acción | Mensaje al cliente |
|---|---|---|---|---|---|
| E01 | Grupo sin fotos | Pre-validación (UI) | `photoUrls.length === 0` | Botón "Analizar" deshabilitado | "Añade al menos una foto para analizar" |
| E02 | Foto de baja calidad | Gemini + adaptador | `nivel_analisis = 2` con `LOW_LIGHT` / `LOW_SHARPNESS` / `ELEMENT_NOT_FULLY_VISIBLE` | Resultado con observaciones visibles; cliente puede reanalizar con mejores fotos | Observaciones traducidas en la card de resultado |
| E03 | Sin palmeras en las fotos | Gemini (`palmas: []` o todo nivel 3) | Post-validación en `analyzePalmGroup` | Modal informativo, no bloquea | "No se han detectado palmeras claras en las imágenes. Añádelas manualmente o prueba con fotos más cercanas." |
| E05 | Especie/banda sin cobertura del jardinero | Motor (`buildPalmQuoteMetadata`) | `isPriced: false` para algún grupo → `partial_palm_coverage` | Excluir a ESE jardinero solo para este trabajo (ProvidersPage) | El cliente solo ve jardineros que cubren su solicitud |
| E06 | Confianza baja en variable crítica | Post-validación (UI) | `especie_confidence`/`altura_confidence` < 0.8 (`PALM_CONFIDENCE_REVIEW_THRESHOLD`) o especie " o similar" | Aviso ámbar bajo el campo + select editable obligatorio a la vista | "La IA no está segura de la especie: revísala, influye en el precio." / "Revisa la altura: en las fotos no había una referencia de escala clara." |
| E07 | Recargo propuesto por IA | Post-validación (UI) | `stateProposedByAI && state ≠ normal` | Chips de estado editables + aviso hasta interacción del cliente | "Estado propuesto por la IA según tus fotos. Puede aplicar un recargo del profesional: confírmalo o corrígelo." |
| E08 | Fallo técnico (429 / 5xx / JSON inválido) | Edge (`callGemini`) | HTTP ≠ 200 o parse error | 3 intentos con backoff solo en 429; después `reasons[]` técnico → `AnalysisFailedCard` con botón reanalizar; alternativa: entrada manual (`dataInputMode: 'manual'`) | "No pudimos completar el análisis. Reintenta o introduce los datos manualmente." |
| E09 | Altura implausible por especie | Post-validación (edge) | `altura_m > PALM_SPECIES_MAX_PLAUSIBLE_HEIGHT_M[especie]` | `nivel_analisis ≥ 2` + `AMBIGUOUS_SIZE`; UI muestra aviso de revisión de altura | Aviso E06 de altura |
| E10 | Cantidad ambigua (varias palmeras en fotos) | Gemini + UI | `aiDetectedCount > 1` | La IA propone; cantidad por defecto 1 y banner con el desglose detectado | "La IA ha detectado N palmeras en estas fotos (resumen). Confirma cuántas quieres podar…" |

Reglas transversales:
- Ningún rechazo sin instrucción de corrección; ningún fallo técnico pierde la reserva
  (siempre existe reanálisis y el flujo de declaración manual).
- La IA jamás activa `hasAccessDifficulty`, extras ni recargos: solo propone estado
  y el cliente confirma.

---

## 5. Guía del cliente (Details Page)

Texto in-app implementado (título "Fotos de tus palmeras"):

> Sube 1-3 fotos por cada tipo de palmera: la palmera entera (desde la base del tronco
> hasta la corona) y, si puedes, un detalle de la corona. Hazlas de día, con el sol a tu
> espalda y sin recortar la copa. Truco: si alguien se pone al lado de la palmera
> calculamos la altura con más precisión. Si tienes varias iguales en especie, tamaño y
> estado, basta una foto: luego confirmas cuántas son.

Versión extendida (para landing/ayuda):

**📸 Las fotos que necesitamos (1–3 por tipo de palmera)**
1. **Palmera entera** — colócate a suficiente distancia para que entre desde la base del
   tronco hasta la punta de la copa. Sin recortes: la altura sale de esta foto.
2. **Detalle de la corona** (opcional) — para valorar hojas secas y estado.

**Para que salgan bien:**
- De día y con el sol a tu espalda (evita contraluces).
- Truco de escala: pide a alguien que se ponga al lado, o deja una silla/cubo junto al
  tronco — así tu precio es exacto y evitas sorpresas.
- Nítida: toca la pantalla sobre la palmera para enfocar antes de disparar.

✅ Foto válida: palmera completa, tronco y copa visibles, con una persona al lado.
❌ Foto no válida: copa cortada por el encuadre, contraluz fuerte, palmera lejana entre
otros árboles.

**✍️ Después del análisis**
Te mostramos especie, altura y estado detectados para que los confirmes o corrijas en un
toque. Si tienes varias palmeras iguales, ajusta la cantidad. Después verás el precio
cerrado de cada jardinero disponible: sin visitas previas ni sorpresas.
