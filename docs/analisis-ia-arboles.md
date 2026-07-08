# Sistema de análisis y reserva — Poda de Árboles

Documento de diseño del flujo IA end-to-end (Gemini 2.5 Flash) para el servicio
**Poda de Árboles**. Los 5 entregables siguen las plantillas de la skill
`garser-ai-analysis-flows`. El código implementado vive en:

- Prompt: `supabase/functions/ai-pricing-estimator/new_prompts.ts` (módulo `'Poda de árboles'`)
- Post-validación: `supabase/functions/ai-pricing-estimator/index.ts` (`sanitizeTreeResult`)
- Contrato: `src/shared/analysisV2.ts` (`TreeMetric`, `LegacyTreeResult`)
- Adaptador: `src/pages/reserva/detailsPageAdapters.ts` (`adaptTreeAnalysisResult`)
- UI de reserva: `src/pages/reserva/DetailsPage.tsx` (sección `isTreeService`)
- Motor de precios autoritativo: `src/domain/pricing/treePruningPricing.ts` vía `buildAuthoritativeBookingQuote`

---

## 1. Flujo de análisis documentado

### Variables de precio que debe producir el análisis
(fuente: `garser-pricing-rules` §6.3 / §7.3 / §10.3 — árboles es **solo `per_quantity`**)

| Variable del motor | Tipo | Fuente primaria | Fuente de verificación |
|---|---|---|---|
| `treeGroups[].pruningType` | enum `shaping` (formación) \| `structural` (estructural) | **Cliente** (chips en la card; el prompt tiene prohibido clasificarlo) | — |
| `treeGroups[].aiSizeBand` | enum `small` (0-3m) \| `medium` (3-5m) \| `large` (5-9m) \| `over_9` (>9m) | IA (altura total en foto) | Cliente confirma/corrige en select (aviso si confidence <0.8) |
| `treeGroups[].quantity` | entero ≥1 | Cliente (stepper) | IA propone (`aiDetectedCount` + resumen por bandas) |
| `treeGroups[].difficultyHigh` → `dificultad_alta` | boolean → `config.difficultyIncrease` (%) | **Cliente** (pregunta explícita de acceso, obligatoria para continuar) | **Nunca la IA** (`treePruningPricing.ts`: la envoltura IA fuerza `false`; el edge también) |
| `wasteRemoval` (global) | boolean → `config.wasteRemovalMultiplier` (%) | Cliente | — |

Reglas de exclusión del motor: árboles `large`/`over_9` requieren `config.[tipo].large > 0`
y `yield_units_per_hour.[tipo].large > 0`; si faltan, el jardinero queda excluido para ese
trabajo (`invalid_tree_config`). `over_9` se cobra con el precio de `large` + warning de
verificación por el profesional.

### Fase 1 — Input del cliente (Details Page)
**Fotos por grupo (1–5, mínimo 1):**
- El árbol entero: desde la base del tronco hasta la punta de la copa, sin recortes.
- Truco de escala: persona/puerta/valla junto al árbol.
- Un grupo por cada árbol o conjunto de árboles parecidos (mismo tamaño); la cantidad se
  confirma después.

**Formulario:** ninguno antes del análisis. Tras el análisis el cliente confirma: tipo de
poda (formación/estructural — decisión 100% del cliente), tamaño, cantidad y la pregunta
de acceso.

### Fase 2 — Pre-validación (sin IA)
- Grupo sin fotos → botón "Analizar" deshabilitado + aviso.
- Máximo 5 fotos por grupo; validación de formato/tamaño en `bookingPhotoPipeline`.

### Fase 3 — Análisis Gemini
- **Una llamada por grupo** (`analyzeTreeGroup`).
- Config: `gemini-2.5-flash`, `temperature 0`, `topP 1`, `topK 1`,
  `response_mime_type: application/json` (settings deterministas compartidos).
- Salida: `arboles[]`, un objeto por árbol objetivo distinto (el principal primero), con
  `altura_m` (altura TOTAL), `size_band`, confidences, `referencia_escala` y
  `dificultad_alta: false` fijo.

### Fase 4 — Post-validación y reconciliación (edge, `sanitizeTreeResult`)
- `dificultad_alta` forzada a `false` (defensa en profundidad de la regla de negocio).
- Confidences saneadas a [0,1].
- Plausibilidad: `altura_m > 40 m` → `nivel_analisis ≥ 2` + `AMBIGUOUS_SIZE`.
- En cliente: `nivel_analisis = 3` o sin `size_band` → grupo marcado `isFailed`
  (excluido del precio y del tiempo).

### Fase 5 — Confirmación del cliente (resumen editable)
- **Tipo de poda**: chips "Poda de formación" / "Poda estructural" con descripción,
  siempre visibles (antes el flujo con fotos fijaba estructural sin preguntar).
- **Tamaño**: select con las 4 bandas etiquetadas ("Pequeño (0-3m)"…), preseleccionada la
  banda propuesta por la IA. Aviso ámbar si `size_band_confidence < 0.8`.
- **Cantidad**: stepper; si la IA detectó >1 árbol se muestra el banner con el desglose
  por bandas (`aiDetectedCount` + `aiDetectedSummary`) y el cliente decide.
- **Acceso**: pregunta explícita Sí/No obligatoria (gate en "Continuar": "Responde la
  pregunta de acceso en cada árbol").
- **over_9**: warning visible "El profesional tendrá que verificar el pago…".

### Fase 6 — Handoff al motor de precios
Payload → `buildAuthoritativeBookingQuote` (por jardinero, en ProvidersPage). El motor
repite cada grupo según `quantity`:
```json
{
  "treeGroups": [
    {
      "id": "tree-1",
      "pruningType": "shaping",
      "quantity": 3,
      "aiSizeBand": "medium",
      "difficultyHigh": true,
      "analysisLevel": 1
    }
  ],
  "wasteRemoval": true
}
```

---

## 2. System prompt Gemini 2.5 Flash

### Configuración (producción)
- model: `gemini-2.5-flash` · temperature 0 · topP 1 · topK 1
- response_mime_type: `application/json`
- Reintentos: 3 con backoff solo en 429.

Ensamblado: `UNIVERSAL_BACKBONE` (solo JSON, sin precios, dedup multi-foto, niveles
1/2/3, códigos de observación cerrados) + módulo específico (fuente en `new_prompts.ts`):

- **Objetivo**: detectar los árboles objetivo distintos, estimar altura TOTAL, clasificar
  `size_band` y reportar confidence. Prohibido clasificar el tipo de poda o calcular horas.
- **Procedimiento**: contar/deduplicar con anclas → referencias de escala (persona 1,70 m,
  puerta 2 m, planta 2,8–3 m, valla 1,2 m, coche 1,5 m) → medir altura total (suelo →
  punta de copa; a diferencia de palmeras, la copa SÍ cuenta) → clasificar banda →
  confidences.
- **Definiciones operativas de bandas**: small <3 m (alcanzable desde el suelo/escalera
  corta), medium 3–<5 m (una planta con tejado), large 5–<9 m (dos plantas, requiere
  elevación), over_9 ≥9 m (por encima de dos plantas, alto riesgo). A <±0,5 m de una
  frontera → confidence <0.8.
- **Plausibilidad**: 1–40 m; fuera → nivel 2/3 + `AMBIGUOUS_SIZE`, nunca forzar el valor.
- **Calibración de confidence**: ≥0.9 con referencia de escala y árbol completo ·
  0.6–0.89 apoyo parcial · <0.6 suposición (el sistema pedirá confirmación). Sin
  referencia de escala, `altura_confidence < 0.9`.
- **`dificultad_alta` siempre `false`**: la lógica de negocio no depende de la dificultad
  estimada por la IA.

---

## 3. JSON schema de extracción + ejemplo

```json
{
  "razonamiento_transversal": {
    "medicion_principal": "string",
    "deduplicacion": "string",
    "calidad": "string",
    "conflictos": "string"
  },
  "arboles": [
    {
      "indice_imagen": 0,
      "altura_m": 0.0,
      "altura_confidence": 0.0,
      "referencia_escala": "string | null",
      "size_band": "small | medium | large | over_9",
      "size_band_confidence": 0.0,
      "dificultad_alta": false,
      "nivel_analisis": 1,
      "observaciones": ["AMBIGUOUS_SIZE", "..."]
    }
  ]
}
```

**Ejemplo de respuesta válida** (2 árboles, uno con referencia de escala):

```json
{
  "razonamiento_transversal": {
    "medicion_principal": "Altura del olivo comparada con la persona (~1,70 m) junto al tronco en la imagen 0.",
    "deduplicacion": "Las imágenes 0 y 1 muestran el mismo olivo (misma valla y caseta); la imagen 2 muestra un segundo árbol distinto junto a la piscina.",
    "calidad": "Árbol principal completo y nítido con referencia de escala (nivel 1); el segundo sin referencia clara (nivel 2).",
    "conflictos": "ninguno"
  },
  "arboles": [
    {
      "indice_imagen": 0,
      "altura_m": 4.2,
      "altura_confidence": 0.9,
      "referencia_escala": "persona ≈ 1,70 m",
      "size_band": "medium",
      "size_band_confidence": 0.9,
      "dificultad_alta": false,
      "nivel_analisis": 1,
      "observaciones": null
    },
    {
      "indice_imagen": 2,
      "altura_m": 6.5,
      "altura_confidence": 0.65,
      "referencia_escala": null,
      "size_band": "large",
      "size_band_confidence": 0.7,
      "dificultad_alta": false,
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
| E02 | Foto de baja calidad | Gemini + adaptador | `nivel_analisis = 2` con códigos de observación | Resultado con observaciones visibles; reanalizar disponible | Observaciones traducidas en la card |
| E03 | Sin árboles en las fotos | Gemini (`arboles: []`) | Post-validación en flujo global / `isFailed` en grupo | Modal informativo / `AnalysisFailedCard` | "La IA no ha encontrado árboles claros en la imagen. Asegúrate de que el árbol sea el protagonista de la foto." |
| E05 | Árbol `large`/`over_9` sin config del jardinero | Motor (`canHandleTree`) | `pricing.large` o `yields.large` faltantes | Excluir a ESE jardinero solo para este trabajo (`invalid_tree_config`) | El cliente solo ve jardineros que cubren su solicitud |
| E06 | Confianza baja en tamaño | Post-validación (UI) | `size_band_confidence < 0.8` (`PALM_CONFIDENCE_REVIEW_THRESHOLD`) | Aviso ámbar bajo el select de tamaño | "Revisa el tamaño: en las fotos no había una referencia de escala clara. Influye en el precio." |
| E07 | Acceso sin responder | Gate de continuar | `typeof difficultyHigh !== 'boolean'` en algún árbol válido | Bloquear "Continuar" | "Responde la pregunta de acceso en cada árbol antes de continuar." |
| E08 | Fallo técnico (429 / 5xx / JSON inválido) | Edge (`callGemini`) | HTTP ≠ 200 o parse error | 3 intentos con backoff en 429; después `reasons[]` → `AnalysisFailedCard`; alternativa entrada manual | "No pudimos completar el análisis. Reintenta o introduce los datos manualmente." |
| E09 | Altura implausible | Post-validación (edge) | `altura_m > 40` | `nivel ≥ 2` + `AMBIGUOUS_SIZE` → aviso E06 | Aviso de revisión de tamaño |
| E10 | Varios árboles en las fotos | Gemini + UI | `aiDetectedCount > 1` | La IA propone; cantidad por defecto 1 y banner con desglose por bandas | "La IA ha detectado N árboles en estas fotos (…). Confirma cuántos quieres podar…" |
| E11 | `dificultad_alta` propuesta por IA | Edge (`sanitizeTreeResult`) | Cualquier valor ≠ false | Forzar `false` silenciosamente (el recargo solo sale de la pregunta de acceso) | — |
| E12 | `over_9` | Motor + UI | banda `over_9` | Cotizar con precio `large` + warning permanente | "El profesional tendrá que verificar el pago porque es un servicio muy complejo." |

Reglas transversales: ningún rechazo sin instrucción de corrección; ningún fallo técnico
pierde la reserva (reanálisis + declaración manual); el tipo de poda y la dificultad son
SIEMPRE decisiones del cliente.

---

## 5. Guía del cliente (Details Page)

Texto in-app implementado (título "Fotos de los árboles"):

> Sube 1-3 fotos por cada árbol o grupo de árboles iguales: el árbol entero (desde la
> base del tronco hasta la punta de la copa), de día y sin recortar la copa. Truco: si
> alguien se pone al lado del árbol calculamos su tamaño con más precisión. Si tienes
> varios árboles parecidos, basta una foto: luego confirmas cuántos son.

Versión extendida (para landing/ayuda):

**📸 Las fotos que necesitamos (1–3 por árbol o grupo de árboles iguales)**
1. **Árbol entero** — aléjate lo suficiente para que entre desde la base del tronco hasta
   la punta de la copa. De la foto sale el tamaño, y el tamaño decide el precio.
2. **Otro ángulo** (opcional) — si el árbol está pegado a un muro o a otra vegetación.

**Para que salgan bien:**
- De día y con el sol a tu espalda (evita contraluces).
- Truco de escala: pide a alguien que se ponga al lado del árbol — así tu precio es
  exacto y evitas sorpresas.
- Nítida: toca la pantalla sobre el árbol para enfocar antes de disparar.

✅ Foto válida: árbol completo con la copa entera y una persona al lado.
❌ Foto no válida: copa cortada por el encuadre, contraluz, árbol lejano entre otros.

**✍️ Después del análisis**
Te mostramos el tamaño detectado para que lo confirmes o corrijas en un toque, eliges el
tipo de poda (formación o estructural), cuántos árboles iguales son, y respondes una
pregunta sobre el acceso. Después verás el precio cerrado de cada jardinero disponible:
sin visitas previas ni sorpresas.
