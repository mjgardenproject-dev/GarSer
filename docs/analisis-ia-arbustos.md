# Sistema de análisis y reserva — Poda de Plantas y Arbustos

Documento de diseño del flujo IA end-to-end (Gemini 2.5 Flash) para el servicio
**Poda de plantas y arbustos**. Los 5 entregables siguen las plantillas de la skill
`garser-ai-analysis-flows`. El código implementado vive en:

- Prompt: `supabase/functions/ai-pricing-estimator/new_prompts.ts` (módulo `'Poda de plantas y arbustos'`)
- Post-validación y merge: `supabase/functions/ai-pricing-estimator/index.ts` (bloque de merge de tareas de arbustos)
- Contrato: `src/shared/analysisV2.ts` (`ShrubServiceMetrics`, `LegacyAiTask.estado_plantas`)
- Adaptador: `src/pages/reserva/detailsPageAdapters.ts` (`adaptShrubAnalysisResult`)
- UI de reserva: `src/pages/reserva/DetailsPage.tsx` (sección `isShrubService`)
- Entrada manual: `src/shared/manualEntry/manualEntrySchema.ts` (survey `shrub`) + `src/pages/reserva/manualEntryBuilders.ts`
- Motor de precios autoritativo: `src/shared/bookingQuoteCore.ts` (bloque `shrubGroups`)

---

## 1. Flujo de análisis documentado

### Variables de precio que debe producir el análisis
(fuente: `garser-pricing-rules` §6.5 / §7.5 / §10.5)

| Variable del motor | Tipo | Fuente primaria | Fuente de verificación |
|---|---|---|---|
| `shrubGroups[].area` | m² (→ `prices_per_m2[size]` o `yield_m2_per_hour[size]`) | IA (contorno del macizo con escala) | Cliente confirma/corrige en input numérico (aviso si confidence <0.8) |
| `shrubGroups[].size` | enum `pequeñas` \| `medianas` \| `grandes` | IA (foto) | Cliente confirma/corrige en select |
| `shrubGroups[].state` | enum `normal` \| `descuidado` \| `muy_descuidado` → `condition_surcharges.media/alta` | IA propone | **Cliente confirma SIEMPRE** (chips + aviso de recargo) |
| `wasteRemoval` (global) | boolean → `waste_removal.percentage` (%) | Cliente | — |

> Ojo con los nombres (§10.5): en arbustos el recargo `media` corresponde a estado
> *descuidado* y `alta` a *muy descuidado* (defaults 20%/50%).

**Corrección clave de esta revisión:** el motor siempre cobró `condition_surcharges`
según `group.state`, pero ninguna capa (IA, UI, entrada manual, tipos) capturaba el
estado → siempre iba `normal` y los recargos configurados por el jardinero no se
aplicaban jamás (infracobro y bloqueo de slots insuficiente). Ahora el estado existe en
todo el recorrido.

### Fase 1 — Input del cliente (Details Page)
**Fotos por grupo/macizo (1–5, mínimo 1):**
- El macizo completo desde 3–5 m y, opcionalmente, un detalle del follaje.
- Truco de escala: silla o cubo de basura junto al macizo.
- Un grupo por cada macizo separado.

**Formulario:** ninguno antes del análisis. Después: superficie, tamaño dominante y
estado, todos editables.

### Fase 2 — Pre-validación (sin IA)
- Grupo sin fotos → botón "Analizar" deshabilitado + aviso.
- Máximo 5 fotos por grupo; validación de formato/tamaño en `bookingPhotoPipeline`.

### Fase 3 — Análisis Gemini
- **Una llamada por grupo** (`analyzeShrubGroup`).
- Config: `gemini-2.5-flash`, `temperature 0`, `topP 1`, `topK 1`,
  `response_mime_type: application/json`.
- Salida: `tareas[]` con `superficie_m2` (política de área bruta del macizo),
  `tamano_dominante`, `estado_plantas`, confidences, `referencia_escala` y
  `razonamiento_cot`.

### Fase 4 — Post-validación y reconciliación (edge)
- Merge de tareas del mismo tamaño dominante: suma superficies, une observaciones e
  índices, conserva el **peor** `nivel_analisis` y el **estado más severo**
  (`worstShrubState` — criterio del motor: manda el peor estado de la zona).
- Confidences saneadas a [0,1] (`clampConfidence`).
- Plausibilidad: `superficie_m2 > 500 m²` → `nivel_analisis = 2` + `AMBIGUOUS_SIZE`.
- `nivel_analisis = 3` → superficie 0, tamaño y estado null, `ELEMENTS_NOT_DETECTED`.

### Fase 5 — Confirmación del cliente (resumen editable)
- **Superficie (m²)**: input numérico editable; aviso ámbar si
  `superficie_confidence < 0.8` ("no había una referencia de escala clara").
- **Tamaño dominante**: select con definiciones caseras ("bajo la rodilla", "hasta el
  pecho", "sobre la cabeza"); aviso si `tamano_confidence < 0.8`.
- **Estado**: chips Normal / Descuidadas / Muy descuidadas, preseleccionado el propuesto
  por la IA. Si propuso ≠ normal: aviso "puede aplicar un recargo del profesional:
  confírmalo o corrígelo" hasta que el cliente toque el control (`stateProposedByAI`).
- **Entrada manual**: el wizard ahora pregunta también el estado (paso nuevo con las
  mismas 3 opciones); al ser declarado por el cliente no necesita re-confirmación.
- Gate al continuar: al menos un grupo válido con superficie > 0.

### Fase 6 — Handoff al motor de precios
Payload → `buildAuthoritativeBookingQuote` (por jardinero, en ProvidersPage):
```json
{
  "shrubGroups": [
    { "id": "shrub-1", "area": 18, "size": "medianas", "state": "descuidado" }
  ],
  "wasteRemoval": true
}
```

---

## 2. System prompt Gemini 2.5 Flash

### Configuración (producción)
- model: `gemini-2.5-flash` · temperature 0 · topP 1 · topK 1
- response_mime_type: `application/json` · reintentos: 3 con backoff solo en 429.

Ensamblado: `UNIVERSAL_BACKBONE` + módulo específico (fuente en `new_prompts.ts`):

- **Objetivo**: superficie de poda por contorno exterior de cada macizo continuo,
  deduplicación multi-foto, tamaño dominante, estado y confidence por campo.
- **Procedimiento**: deduplicar con anclas → referencias de escala (persona 1,70 m,
  puerta 2 m, valla 1,2 m, cubo 1 m, baldosa 0,4 m) → medir huella de cada macizo
  (política de área bruta: incluye huecos internos del macizo, excluye caminos,
  pavimento e islas no objetivo) → clasificar tamaño y estado → confidences.
- **Tamaño dominante** (altura de la masa principal): pequeñas <rodilla (~0,5 m) ·
  medianas hasta cintura/pecho (0,5–1,4 m) · grandes sobre la cabeza (≥1,8 m).
- **Estado** (criterios observables): normal (formas definidas, brotes <10 cm, sin
  madera seca) · descuidado (brotes 10–50 cm, formas irregulares, invasión de bordes) ·
  muy descuidado (brotes >50 cm, formas perdidas, madera seca o invasión de malas
  hierbas/zarzas). Sin detalle de follaje → null + confidence baja.
- **Plausibilidad**: macizos residenciales 1–500 m²; por encima → nivel 2/3 +
  `AMBIGUOUS_SIZE`.
- **Confidence**: ≥0.9 medible con escala clara y macizo completo · 0.6–0.89 apoyo
  parcial · <0.6 suposición. Sin referencia de escala, `superficie_confidence < 0.9`.

---

## 3. JSON schema de extracción + ejemplo

```json
{
  "razonamiento_transversal": { "medicion_principal": "…", "deduplicacion": "…", "calidad": "…", "conflictos": "…" },
  "tareas": [
    {
      "tipo_servicio": "Poda de plantas y arbustos",
      "razonamiento_cot": {
        "identificacion_escalas": "string",
        "calculo_area_plantas": "string",
        "deduplicacion_multifoto": "string"
      },
      "superficie_m2": 0.0,
      "superficie_confidence": 0.0,
      "referencia_escala": "string | null",
      "tamano_dominante": "pequeñas | medianas | grandes | null",
      "tamano_confidence": 0.0,
      "estado_plantas": "normal | descuidado | muy descuidado | null",
      "estado_confidence": 0.0,
      "nivel_analisis": 1,
      "observaciones": ["AMBIGUOUS_SIZE", "…"],
      "indices_imagenes": [0]
    }
  ]
}
```

**Ejemplo de respuesta válida:**

```json
{
  "razonamiento_transversal": {
    "medicion_principal": "Macizo medido contra la valla (~1,2 m) y las baldosas del camino (~0,4 m) visibles en las imágenes 0 y 1.",
    "deduplicacion": "Las imágenes 0 y 1 muestran el mismo macizo desde dos ángulos (misma esquina de valla); no hay más macizos objetivo.",
    "calidad": "Macizo completo y nítido con referencias de escala; nivel 1.",
    "conflictos": "ninguno"
  },
  "tareas": [
    {
      "tipo_servicio": "Poda de plantas y arbustos",
      "razonamiento_cot": {
        "identificacion_escalas": "Valla de 1,2 m y baldosas de 40 cm junto al macizo.",
        "calculo_area_plantas": "Contorno de ~6 × 3 m siguiendo el borde del parterre = 18 m².",
        "deduplicacion_multifoto": "Imágenes 0-1 = mismo macizo; conservado el mayor alcance visible."
      },
      "superficie_m2": 18,
      "superficie_confidence": 0.9,
      "referencia_escala": "valla de jardín ≈ 1,2 m",
      "tamano_dominante": "medianas",
      "tamano_confidence": 0.85,
      "estado_plantas": "descuidado",
      "estado_confidence": 0.8,
      "nivel_analisis": 1,
      "observaciones": null,
      "indices_imagenes": [0, 1]
    }
  ]
}
```

---

## 4. Matriz de errores

| # | Fallo | Capa | Regla de detección | Acción | Mensaje al cliente |
|---|---|---|---|---|---|
| E01 | Grupo sin fotos | Pre-validación (UI) | `photoUrls.length === 0` | Botón deshabilitado | "Añade al menos una foto para analizar" / "Sube al menos una foto del macizo" |
| E02 | Foto de baja calidad | Gemini + adaptador | `nivel_analisis = 2` con códigos | Resultado con observaciones; reanalizar disponible | Observaciones traducidas en la card |
| E03 | Sin plantas en las fotos | Gemini (nivel 3) | `superficie_m2 = 0`, `ELEMENTS_NOT_DETECTED` | `AnalysisFailedCard` + reanalizar | "Intenta hacer la foto desde otro ángulo" |
| E05 | Tamaño sin tarifa del jardinero | Motor | `prices_per_m2[size]` o `yield_m2_per_hour[size]` faltantes | Excluir a ese jardinero (`missing_pricing_config` / `missing_yield_config`) | El cliente solo ve jardineros que cubren su solicitud |
| E06 | Confianza baja en superficie/tamaño | Post-validación (UI) | confidence < 0.8 | Aviso ámbar bajo el campo editable | "Revisa la superficie: en las fotos no había una referencia de escala clara." |
| E07 | Recargo propuesto por IA | Post-validación (UI) | `stateProposedByAI && state ≠ normal` | Chips editables + aviso hasta interacción | "Estado propuesto por la IA según tus fotos. Puede aplicar un recargo del profesional: confírmalo o corrígelo." |
| E08 | Fallo técnico | Edge (`callGemini`) | HTTP ≠ 200 / parse error | 3 intentos backoff en 429; `reasons[]` → `AnalysisFailedCard`; alternativa manual | "No pudimos completar el análisis. Reintenta o introduce los datos manualmente." |
| E09 | Superficie implausible | Post-validación (edge) | `superficie_m2 > 500` | `nivel = 2` + `AMBIGUOUS_SIZE` → aviso E06 | Aviso de revisión de superficie |
| E10 | Continuar sin datos válidos | Gate de continuar | Ningún grupo válido con `area > 0` | Bloquear "Continuar" | "Analiza al menos un grupo de plantas con superficie válida para continuar." |
| E11 | Macizos de distinto tamaño mezclados | Edge (merge) | Tareas con `tamano_dominante` distinto | Se mantienen como tareas separadas agrupadas por tamaño; el estado más severo manda dentro de cada grupo | — |

---

## 5. Guía del cliente (Details Page)

Texto in-app implementado (título "Fotos de tus plantas y arbustos"):

> Sube 1-3 fotos por cada macizo o grupo de plantas: el macizo completo desde 3-5 m y,
> si puedes, un detalle del follaje. Hazlas de día y con el sol a tu espalda. Truco:
> deja una silla o el cubo de basura junto al macizo — así calculamos la superficie con
> más precisión. Si tienes macizos separados, añade un grupo por cada uno.

Versión extendida (para landing/ayuda):

**📸 Las fotos que necesitamos (1–3 por macizo)**
1. **Macizo completo** — desde 3–5 m, que entre todo el parterre en el encuadre.
2. **Detalle del follaje** (opcional) — a ~1 m, para valorar el estado de las plantas.

**Para que salgan bien:**
- De día y con el sol a tu espalda (evita contraluces).
- Truco de escala: deja una silla o el cubo de basura junto al macizo — así tu precio es
  exacto y evitas sorpresas.
- Nítida: toca la pantalla sobre las plantas para enfocar antes de disparar.

✅ Foto válida: parterre completo con una referencia de tamaño al lado.
❌ Foto no válida: primer plano de una sola planta, contraluz, macizo cortado por el
encuadre.

**✍️ Después del análisis**
Te mostramos la superficie, el tamaño y el estado detectados para que los confirmes o
corrijas en un toque. Después verás el precio cerrado de cada jardinero disponible: sin
visitas previas ni sorpresas.
