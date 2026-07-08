# Sistema de análisis y reserva — Corte de Césped

Documento de diseño del flujo IA end-to-end (Gemini 2.5 Flash) para el servicio
**Corte de césped**. Los 5 entregables siguen las plantillas de la skill
`garser-ai-analysis-flows`. El código implementado vive en:

- Prompt: `supabase/functions/ai-pricing-estimator/new_prompts.ts` (módulo `'Corte de césped'`)
- Post-validación: `supabase/functions/ai-pricing-estimator/index.ts` (bloque de saneamiento de césped)
- Contrato: `src/shared/analysisV2.ts` (`LawnServiceMetrics`)
- Adaptador: `src/pages/reserva/detailsPageAdapters.ts` (`adaptLawnAnalysisResult`)
- UI de reserva: `src/pages/reserva/DetailsPage.tsx` (`LawnZoneCard`, `updateLawnZone`)
- Entrada manual: `src/shared/manualEntry/manualEntrySchema.ts` (survey `lawn`, ya correcta)
- Motor de precios autoritativo: `src/shared/bookingQuoteCore.ts` (bloque `lawnZones`)

---

## 1. Flujo de análisis documentado

### Variables de precio que debe producir el análisis
(fuente: `garser-pricing-rules` §6.1 / §7.1)

| Variable del motor | Tipo | Fuente primaria | Fuente de verificación |
|---|---|---|---|
| `lawnZones[].quantity` | m² (→ `price_per_m2` o `yield_m2_per_hour`) | IA (contorno del césped con escala) | Cliente confirma/corrige en input numérico (aviso si confidence <0.8) |
| `lawnZones[].state` | enum `normal` \| `descuidado` \| `muy descuidado` → `condition_surcharges.descuidado/muy_descuidado` | IA propone | **Cliente confirma SIEMPRE** (chips + aviso de recargo) |
| `wasteRemoval` (global) | boolean → `waste_removal.percentage` | Cliente | — |

**Corrección clave de esta revisión (mismo patrón que arbustos/setos):** el estado
propuesto por la IA (descuidado +20% / muy descuidado +50% por defecto) se aplicaba al
precio sin confirmación del cliente, y ni la superficie ni el estado eran corregibles
tras el análisis. Ahora la card es editable y el recargo lleva aviso hasta que el
cliente lo confirma (`stateProposedByAI`).

### Fase 1 — Input del cliente (Details Page)
**Fotos por zona (máx. 4 zonas, 5 fotos por zona, mínimo 1):**
- El césped completo desde una esquina, con los bordes visibles.
- Detalle de la altura de la hierba (opcional, mejora el estado).
- Truco de escala: puerta, valla o mesa de jardín en el encuadre.

**Formulario:** ninguno antes del análisis. Después: superficie y estado, editables.

### Fase 2 — Pre-validación (sin IA)
- Zona sin fotos → botón "Analizar" deshabilitado + aviso.
- Máximo 4 zonas; validación de formato/tamaño en `bookingPhotoPipeline`.

### Fase 3 — Análisis Gemini
- **Una llamada por zona** (`analyzeLawnZone`).
- Config: `gemini-2.5-flash`, `temperature 0`, `topP 1`, `topK 1`,
  `response_mime_type: application/json`.
- Salida: tarea única consolidada con `superficie_m2`, `estado_jardin`, confidences y
  `referencia_escala`.

### Fase 4 — Post-validación y reconciliación (edge)
- Confidences saneadas a [0,1] (`clampConfidence`).
- `estado_jardin` normalizado a `normal | descuidado | muy descuidado`.
- Plausibilidad: `superficie_m2 > 2000 m²` → `nivel_analisis = 2` + `AMBIGUOUS_SIZE`
  (un césped doméstico rara vez supera 2.000 m²).
- `nivel 3` → superficie 0 y estado null → `AnalysisFailedCard` en cliente.

### Fase 5 — Confirmación del cliente (resumen editable en `LawnZoneCard`)
- **Superficie (m²)**: input numérico editable; aviso ámbar si
  `superficie_confidence < 0.8`.
- **Estado**: chips Normal / Descuidado / Muy descuidado, preseleccionado el propuesto.
  Si la IA propuso ≠ normal: aviso "puede aplicar un recargo del profesional:
  confírmalo o corrígelo" hasta que el cliente toque el control.
- **Entrada manual**: ya preguntaba superficie (slider 1–2000) y estado — sin cambios.
- Gate al continuar: al menos una zona válida con superficie > 0.

### Fase 6 — Handoff al motor de precios
```json
{
  "lawnZones": [
    { "id": "zone-1", "species": "Césped general", "quantity": 150, "state": "muy descuidado" }
  ],
  "wasteRemoval": true
}
```

---

## 2. System prompt Gemini 2.5 Flash

Config: `gemini-2.5-flash` · temperature 0 · topP 1 · topK 1 ·
`response_mime_type: application/json` · reintentos: 3 con backoff solo en 429.

Ensamblado: `UNIVERSAL_BACKBONE` + módulo específico (fuente en `new_prompts.ts`):

- **Objetivo**: medir el área de césped natural visible y clasificar el estado.
- **Procedimiento**: deduplicar ángulos con anclas → referencias de escala (persona
  1,70 m, puerta 2 m, valla 1,2 m, coche 4,5 m, baldosa 0,4 m) → medir el área siguiendo
  el contorno (excluir caminos, terrazas, parterres y piscinas; sumar parches separados
  del mismo jardín) → clasificar estado → confidences.
- **Estados operativos**: normal (hierba <10 cm, bordes definidos) · descuidado (hierba
  10–25 cm, bordes invadidos) · muy descuidado (hierba >25 cm, espigas o mezcla de malas
  hierbas que exigen pre-corte).
- **Plausibilidad**: 1–2.000 m²; por encima → nivel 2/3 + `AMBIGUOUS_SIZE`.
- **Confidence**: ≥0.9 medible con escala y césped completo · 0.6–0.89 apoyo parcial ·
  <0.6 suposición. Sin referencia de escala → `superficie_confidence < 0.9`.

---

## 3. JSON schema de extracción + ejemplo

```json
{
  "razonamiento_transversal": { "medicion_principal": "…", "deduplicacion": "…", "calidad": "…", "conflictos": "…" },
  "tareas": [
    {
      "tipo_servicio": "Corte de césped",
      "estado_jardin": "normal | descuidado | muy descuidado | null",
      "estado_confidence": 0.0,
      "superficie_m2": 0.0,
      "superficie_confidence": 0.0,
      "referencia_escala": "string | null",
      "nivel_analisis": 1,
      "observaciones": ["AMBIGUOUS_SIZE", "…"]
    }
  ]
}
```

**Ejemplo de respuesta válida:**

```json
{
  "razonamiento_transversal": {
    "medicion_principal": "Área medida contra la puerta corredera (~2 m) y las baldosas de la terraza (~0,4 m) de la imagen 0.",
    "deduplicacion": "Las imágenes 0 y 1 muestran el mismo césped desde dos esquinas (misma pérgola).",
    "calidad": "Césped completo y nítido con referencias; nivel 1.",
    "conflictos": "ninguno"
  },
  "tareas": [
    {
      "tipo_servicio": "Corte de césped",
      "estado_jardin": "descuidado",
      "estado_confidence": 0.85,
      "superficie_m2": 150,
      "superficie_confidence": 0.9,
      "referencia_escala": "puerta corredera ≈ 2 m",
      "nivel_analisis": 1,
      "observaciones": null
    }
  ]
}
```

---

## 4. Matriz de errores

| # | Fallo | Capa | Regla de detección | Acción | Mensaje al cliente |
|---|---|---|---|---|---|
| E01 | Zona sin fotos | Pre-validación (UI) | `photoUrls.length === 0` | Botón deshabilitado | "Añade al menos una foto para analizar" |
| E02 | Foto de baja calidad | Gemini + adaptador | `nivel_analisis = 2` con códigos | Observaciones visibles; reanalizar disponible | Observaciones traducidas en la card |
| E03 | Sin césped en las fotos | Gemini (nivel 3) | `superficie_m2 = 0` + `ELEMENTS_NOT_DETECTED` | `AnalysisFailedCard` + reanalizar; alternativa manual | "Intenta hacer la foto desde otro ángulo" |
| E05 | Config del jardinero incompleta | Motor | `yield_m2_per_hour` o tarifa faltantes | Excluir a ese jardinero (`missing_yield_config`/`missing_pricing_config`) | El cliente solo ve jardineros que cubren su solicitud |
| E06 | Confianza baja en superficie | Post-validación (UI) | `superficie_confidence < 0.8` | Aviso ámbar bajo el input | "Revisa la superficie: en las fotos no había una referencia de escala clara. Influye en el precio." |
| E07 | Recargo propuesto por IA | Post-validación (UI) | `stateProposedByAI && state ≠ normal` | Chips editables + aviso hasta interacción | "Estado propuesto por la IA según tus fotos. Puede aplicar un recargo del profesional…" |
| E08 | Fallo técnico | Edge (`callGemini`) | HTTP ≠ 200 / parse error | 3 intentos backoff en 429; después `AnalysisFailedCard`; alternativa manual | "No pudimos completar el análisis. Reintenta o introduce los datos manualmente." |
| E09 | Superficie implausible | Post-validación (edge) | `superficie_m2 > 2000` | `nivel = 2` + `AMBIGUOUS_SIZE` → aviso E06 | Aviso de revisión de superficie |
| E10 | Continuar sin datos válidos | Gate de continuar | Ninguna zona válida con `quantity > 0` | Bloquear "Continuar" | "Analiza al menos una zona de césped con superficie válida para continuar." |

---

## 5. Guía del cliente (Details Page)

Texto in-app implementado (título "Fotos de tu césped"):

> Sube 1-3 fotos por zona: el césped completo desde una esquina (que se vean los
> bordes) y, si puedes, un detalle de la altura de la hierba. Hazlas de día y con el
> sol a tu espalda. Truco: si en la foto sale una puerta, valla o mesa de jardín
> calculamos los metros con más precisión. Después del análisis podrás confirmar la
> superficie y el estado.

Versión extendida (para landing/ayuda):

**📸 Las fotos que necesitamos (1–3 por zona de césped)**
1. **Césped completo** — desde una esquina del jardín, con los bordes visibles. De aquí
   salen los m², que deciden el precio.
2. **Detalle de la hierba** (opcional) — a ~1 m del suelo, para valorar la altura.

**Para que salgan bien:**
- De día y con el sol a tu espalda (evita contraluces).
- Truco de escala: que salga una puerta, valla o mesa de jardín en el encuadre — así tu
  precio es exacto y evitas sorpresas.
- Si tienes varias zonas de césped separadas, añade una zona por cada una.

✅ Foto válida: césped de esquina a esquina con la terraza o la valla de referencia.
❌ Foto no válida: primer plano de la hierba sola, contraluz, césped cortado por el
encuadre.

**✍️ Después del análisis**
Te mostramos la superficie y el estado detectados para que los confirmes o corrijas en
un toque. Después verás el precio cerrado de cada jardinero disponible: sin visitas
previas ni sorpresas.
