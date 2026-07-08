# Sistema de análisis y reserva — Corte de Setos

Documento de diseño del flujo IA end-to-end (Gemini 2.5 Flash) para el servicio
**Poda de setos**. Los 5 entregables siguen las plantillas de la skill
`garser-ai-analysis-flows`. El código implementado vive en:

- SSOT de bandas y estado: `src/domain/hedgeBusinessRules.ts`
- Prompt: `supabase/functions/ai-pricing-estimator/new_prompts.ts` (módulo `'Poda de setos'`)
- Post-validación: `supabase/functions/ai-pricing-estimator/index.ts` (bloque de saneamiento de setos)
- Contrato: `src/shared/analysisV2.ts` (`HedgeServiceMetrics`)
- UI de reserva: `src/pages/reserva/DetailsPage.tsx` (sección setos, `analyzeHedgeZone`, `updateHedgeZone`)
- Entrada manual: `src/shared/manualEntry/manualEntrySchema.ts` (survey `hedge`) + `src/pages/reserva/manualEntryBuilders.ts`
- Motor de precios autoritativo: `src/shared/bookingQuoteCore.ts` (bloque `hedgeZones`)

---

## 1. Flujo de análisis documentado

### Variables de precio que debe producir el análisis
(fuente: `garser-pricing-rules` §6.2 / §7.2)

| Variable del motor | Tipo | Fuente primaria | Fuente de verificación |
|---|---|---|---|
| `hedgeZones[].length` (y `length_pricing_m`) | m lineales — **longitud BASE, sin caras** | IA (foto con escala) | Cliente confirma/corrige en input (aviso si confidence <0.8; truco: pasos ≈0,8 m) |
| `hedgeZones[].height` | enum `0-2m` \| `2-4m` \| `4-6m` | IA (altura bruta desde el suelo del jardinero) | Cliente confirma/corrige en select |
| `hedgeZones[].faces_to_trim` | 1 \| 2 | **Cliente** (chips explícitos; default = si subió fotos de Cara B) | IA propone `caras_recortar` |
| `hedgeZones[].state` | enum `normal` \| `media` \| `alta` → `condition_surcharges.media/alta` | IA propone | **Cliente confirma SIEMPRE** (chips "Normal/Descuidado/Muy descuidado" + aviso de recargo) |
| `wasteRemoval` (global) | boolean → `waste_removal.percentage` | Cliente | — |

> Semántica crítica del motor: `precio = pricing_matrix[height] × length_pricing_m × faces`.
> `length_pricing_m` debe ser SIEMPRE la longitud base. Guardar `longitud × caras` ahí
> duplica el cobro de la segunda cara (bug corregido en esta revisión).

**Bugs críticos corregidos en esta revisión:**
1. **Bandas fantasma**: el flujo de fotos clasificaba setos ≤2m como `'0-1m'/'1-2m'`,
   claves que no existen en `pricing_matrix` del jardinero (`0-2m/2-4m/4-6m`) →
   `missing_pricing_config` → **cero jardineros disponibles** para la mayoría de setos
   residenciales. Ahora todos los mapeos altura→banda pasan por el SSOT
   `mapHedgeHeightToBand` (UI, manual y dev seeds).
2. **Doble cobro de caras**: el flujo de fotos guardaba `length_pricing_m = longitud ×
   caras` y el motor volvía a multiplicar por `faces_to_trim` → un seto a 2 caras se
   cobraba 4× su longitud. El flujo manual siempre guardó la base (correcto).
3. **Recargo sin confirmación**: el estado (media +20% / alta +50% por defecto) propuesto
   por la IA se aplicaba al precio sin que el cliente lo confirmara.

### Fase 1 — Input del cliente (Details Page)
**Fotos por zona (máx. 4 zonas, 5 fotos por cara):**
- `Cara A (delantera)` — obligatoria: el seto completo desde 3–5 m, con referencia de escala.
- `Cara B (trasera)` — opcional: solo si también quiere recortar la trasera.
- Las etiquetas FACE_A/FACE_B viajan con las imágenes a Gemini (modo `hedge_faces`).

**Formulario:** ninguno antes del análisis. Después: longitud, banda de altura, caras y
estado, todos confirmables.

### Fase 2 — Pre-validación (sin IA)
- Sin fotos en Cara A → botón "Analizar" deshabilitado + aviso.
- Máximo 4 zonas; validación de formato/tamaño en `bookingPhotoPipeline`.

### Fase 3 — Análisis Gemini
- **Una llamada por zona** con ambas caras etiquetadas (`analyzeHedgeZone`).
- Config: `gemini-2.5-flash`, `temperature 0`, `topP 1`, `topK 1`,
  `response_mime_type: application/json`.
- Salida: tarea raíz con `longitud_m`/`altura_m` base, `tipo_seto`, `estado_seto`,
  `detalle_caras` (por cara), `resumen_medicion`, confidences y `referencia_escala`.

### Fase 4 — Post-validación y reconciliación
- **Edge**: confidences saneadas a [0,1]; `estado_seto` normalizado a `normal|media|alta`;
  plausibilidad (altura >8 m o longitud >200 m → `nivel_analisis = 2` + `AMBIGUOUS_SIZE`).
- **Cliente**: banda desde altura base vía SSOT; `length_pricing_m = longitud base`;
  aviso de seguridad si altura >7,5 m; `nivel 3` → `AnalysisFailedCard`.
- Si las caras difieren, la IA consolida (media de caras fiables o cara más fiable).

### Fase 5 — Confirmación del cliente (resumen editable)
- **Longitud (m)**: input numérico; aviso ámbar si `longitud_confidence < 0.8` con el
  truco de los pasos. Al editar se sincroniza `length_pricing_m`.
- **Altura**: select con las 3 bandas etiquetadas ("Bajo (hasta 2 m)"…); aviso si
  confidence <0.8 ("influye en el precio y en qué jardineros pueden hacer el trabajo").
- **Caras**: chips "1 cara (solo la delantera)" / "2 caras (delantera y trasera)" con la
  nota "recortar las dos caras duplica los metros de trabajo". Default: 2 si subió Cara B.
- **Estado**: chips Normal / Descuidado / Muy descuidado (labels de cliente; valores del
  motor `normal/media/alta`). Si la IA propuso ≠ normal: aviso "puede aplicar un recargo
  del profesional: confírmalo o corrígelo" hasta que el cliente toque el control
  (`stateProposedByAI`).
- Gate al continuar: al menos una zona válida con longitud > 0.

### Fase 6 — Handoff al motor de precios
```json
{
  "hedgeZones": [
    {
      "id": "hedge-1",
      "height": "2-4m",
      "length": 18,
      "length_pricing_m": 18,
      "faces_to_trim": 2,
      "state": "media"
    }
  ],
  "wasteRemoval": true
}
```
Exclusión: setos `4-6m` requieren `pricing_matrix['4-6m']` y `yield_ml_per_hour['4-6m']`
del jardinero; si faltan → `missing_pricing_config` / `missing_yield_config` y ese
jardinero no aparece.

---

## 2. System prompt Gemini 2.5 Flash

Config: `gemini-2.5-flash` · temperature 0 · topP 1 · topK 1 ·
`response_mime_type: application/json` · reintentos: 3 con backoff solo en 429.

Ensamblado: `UNIVERSAL_BACKBONE` + módulo específico (fuente en `new_prompts.ts`):

- **Objetivo**: una zona de seto con FACE_A y FACE_B opcional; medir longitud y altura
  base y conservar el resumen consolidado.
- **Procedimiento**: analizar cada cara por separado → referencias de escala (persona
  1,70 m, puerta 2 m, valla 1,2 m, cubo 1 m, baldosa 0,4 m) → longitud y altura base por
  cara (altura bruta: incluye muro/jardinera que el jardinero salva desde el suelo) →
  clasificar banda (a <20 cm de la frontera de 2 m o 4 m → confidence <0.8) → estado →
  confidences.
- **Estados operativos**: normal (brotes <10 cm) · media (brotes 10–50 cm, forma
  irregular) · alta (brotes >50 cm, huecos, madera muerta o invasión de zarzas).
- **Plausibilidad**: altura 0,3–8 m; longitud 1–200 m; fuera → nivel 2/3 + `AMBIGUOUS_SIZE`.
- **Confidence**: ≥0.9 medible con escala y seto completo · 0.6–0.89 apoyo parcial ·
  <0.6 suposición. Sin referencia de escala → longitud y altura <0.9.

---

## 3. JSON schema de extracción + ejemplo

```json
{
  "razonamiento_transversal": { "medicion_principal": "…", "deduplicacion": "…", "calidad": "…", "conflictos": "…" },
  "tareas": [
    {
      "tipo_servicio": "Poda de setos",
      "longitud_m": 0.0,
      "longitud_confidence": 0.0,
      "altura_m": 0.0,
      "altura_confidence": 0.0,
      "referencia_escala": "string | null",
      "tipo_seto": "0-2m | 2-4m | 4-6m | null",
      "estado_seto": "normal | media | alta | null",
      "estado_confidence": 0.0,
      "caras": 1,
      "detalle_caras": {
        "cara_a": { "longitud_m": 0.0, "altura_m": 0.0, "nivel_analisis": 1, "observaciones": ["…"] },
        "cara_b": { "longitud_m": 0.0, "altura_m": 0.0, "nivel_analisis": 1, "observaciones": ["…"] }
      },
      "resumen_medicion": {
        "base_longitud_m": 0.0,
        "base_altura_m": 0.0,
        "caras_recortar": 1,
        "longitud_calculo_m": 0.0,
        "altura_calculo_m": 0.0,
        "metodo": "media_caras | cara_mas_fiable"
      },
      "nivel_analisis": 1,
      "observaciones": ["AMBIGUOUS_SIZE", "…"]
    }
  ]
}
```

**Ejemplo de respuesta válida** (seto de 18 m × 2,4 m con dos caras):

```json
{
  "razonamiento_transversal": {
    "medicion_principal": "Altura contra la valla (~1,2 m) visible en FACE_A; el seto la dobla holgadamente.",
    "deduplicacion": "FACE_A y FACE_B muestran el mismo seto lineal (misma esquina de muro).",
    "calidad": "Ambas caras completas y nítidas con referencia; nivel 1.",
    "conflictos": "ninguno"
  },
  "tareas": [
    {
      "tipo_servicio": "Poda de setos",
      "longitud_m": 18,
      "longitud_confidence": 0.85,
      "altura_m": 2.4,
      "altura_confidence": 0.9,
      "referencia_escala": "valla de jardín ≈ 1,2 m",
      "tipo_seto": "2-4m",
      "estado_seto": "media",
      "estado_confidence": 0.8,
      "caras": 2,
      "detalle_caras": {
        "cara_a": { "longitud_m": 18, "altura_m": 2.4, "nivel_analisis": 1, "observaciones": null },
        "cara_b": { "longitud_m": 18, "altura_m": 2.3, "nivel_analisis": 1, "observaciones": null }
      },
      "resumen_medicion": {
        "base_longitud_m": 18,
        "base_altura_m": 2.4,
        "caras_recortar": 2,
        "longitud_calculo_m": 36,
        "altura_calculo_m": 2.4,
        "metodo": "media_caras"
      },
      "nivel_analisis": 1,
      "observaciones": null
    }
  ]
}
```

> El cliente NUNCA usa `longitud_calculo_m` para pricing: `length_pricing_m` se fija a la
> longitud base y el motor multiplica por `faces_to_trim`.

---

## 4. Matriz de errores

| # | Fallo | Capa | Regla de detección | Acción | Mensaje al cliente |
|---|---|---|---|---|---|
| E01 | Cara A sin fotos | Pre-validación (UI) | `faceA.photoUrls.length === 0` | Botón deshabilitado | "Debes subir al menos una foto de la Cara A para continuar." |
| E02 | Foto de baja calidad | Gemini + adaptador | `nivel_analisis = 2` con códigos | Observaciones visibles; reanalizar disponible | Observaciones traducidas en la card |
| E03 | Sin seto en las fotos | Gemini (nivel 3) | Campos a 0/null + `ELEMENTS_NOT_DETECTED` | `AnalysisFailedCard` + reanalizar; alternativa manual | "Intenta hacer la foto desde otro ángulo" |
| E05 | Seto 4-6m sin config del jardinero | Motor | `pricing_matrix['4-6m']` o `yield_ml_per_hour['4-6m']` faltantes | Excluir a ese jardinero para este trabajo | El cliente solo ve jardineros que cubren su solicitud |
| E06 | Confianza baja en longitud/altura | Post-validación (UI) | confidence < 0.8 | Aviso ámbar bajo el campo editable | "Revisa la longitud… Truco: cuéntala a pasos (1 paso ≈ 0,8 m)." |
| E07 | Recargo propuesto por IA | Post-validación (UI) | `stateProposedByAI && state ≠ normal` | Chips editables + aviso hasta interacción | "Estado propuesto por la IA según tus fotos. Puede aplicar un recargo del profesional…" |
| E08 | Fallo técnico | Edge (`callGemini`) | HTTP ≠ 200 / parse error | 3 intentos backoff en 429; después `AnalysisFailedCard`; alternativa manual | "No pudimos completar el análisis. Reintenta o introduce los datos manualmente." |
| E09 | Medidas implausibles | Post-validación (edge) | altura >8 m o longitud >200 m | `nivel = 2` + `AMBIGUOUS_SIZE` → aviso E06 | Aviso de revisión de medidas |
| E10 | Continuar sin datos válidos | Gate de continuar | Ninguna zona válida con `length > 0` | Bloquear "Continuar" | "Analiza al menos una zona de setos con longitud válida para continuar." |
| E11 | Altura extrema (seguridad) | Post-validación (UI) | `altura_m > 7.5` | Observación permanente en la card | "Altura detectada superior a 7.5m, revisar manualmente por seguridad." |
| E12 | Caras discrepantes | Gemini (consolidación) | Estados/medidas distintos por cara | Media de caras fiables o cara más fiable (`metodo`) | — |

Reglas transversales: ningún rechazo sin instrucción de corrección; el nº de caras y el
estado son SIEMPRE decisiones del cliente antes del checkout.

---

## 5. Guía del cliente (Details Page)

Texto in-app implementado (título "Fotos de tus setos"):

> Sube 1-3 fotos por cara: el seto completo desde 3-5 m (Cara A es la delantera y
> obligatoria; Cara B solo si también quieres recortar la trasera). Hazlas de día y con
> el sol a tu espalda. Truco: si alguien se pone al lado del seto calculamos la altura y
> la longitud con más precisión. Después del análisis podrás confirmar las medidas y
> cuántas caras recortar.

Versión extendida (para landing/ayuda):

**📸 Las fotos que necesitamos (por zona de seto)**
1. **Cara A (delantera), obligatoria** — el seto completo desde 3–5 m, sin cortar los
   extremos. De aquí salen la longitud y la altura, que deciden el precio.
2. **Cara B (trasera), opcional** — solo si también quieres recortarla. Si no la subes,
   podrás igualmente elegir "2 caras" al confirmar.

**Para que salgan bien:**
- De día y con el sol a tu espalda (evita contraluces).
- Truco de escala: pide a alguien que se ponga al lado del seto — así tu precio es
  exacto y evitas sorpresas.
- Si el seto hace esquina, intenta que las dos secciones salgan en la misma foto.

✅ Foto válida: seto completo de extremo a extremo con una persona o valla al lado.
❌ Foto no válida: primer plano del follaje, seto cortado por el encuadre, contraluz.

**✍️ Después del análisis**
Te mostramos la longitud, la altura y el estado detectados para que los confirmes o
corrijas en un toque, y eliges cuántas caras recortar (las dos caras duplican los metros
de trabajo). Después verás el precio cerrado de cada jardinero disponible: sin visitas
previas ni sorpresas.
