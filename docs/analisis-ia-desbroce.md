# Sistema de análisis y reserva — Desbroce de Malas Hierbas

Documento de diseño del flujo de reserva para el servicio **Desbroce de malas hierbas**.
Los 5 entregables siguen las plantillas de la skill `garser-ai-analysis-flows`.

**Decisión de diseño (existente y conservada):** el desbroce es **manual-first**. El
cliente declara superficie, estado y herbicida en un formulario de zona única, y firma
una confirmación explícita ("el profesional podrá recalcular en persona"). No hay
análisis de fotos en la UI actual — un efecto de la página incluso purga artefactos de
IA de las zonas para garantizarlo. Es el diseño MÁS conservador respecto a la regla de
oro (los recargos siempre los decide el cliente), así que la auditoría lo mantiene. El
prompt IA del edge se conserva y refuerza como SSOT (lo usa el modo QA de repetibilidad
y quedaría listo si se reactiva el flujo con fotos).

El código vive en:

- Formulario: `src/pages/reserva/DetailsPage.tsx` (sección "Detalles del Desbroce", `updateSingleWeedingZone`)
- Prompt: `supabase/functions/ai-pricing-estimator/new_prompts.ts` (módulo `'Desbroce de malas hierbas'`)
- Post-validación/consolidación edge: `normalizeWeedingTask` / `parseWeedingResult` en `index.ts` (+ modo `weeding_prompt_quality_check`)
- Contrato: `src/shared/analysisV2.ts` (`WeedingServiceMetrics`)
- Entrada manual (wizard): `src/shared/manualEntry/manualEntrySchema.ts` (survey `weeding`)
- Motor: `src/shared/bookingQuoteCore.ts` (`calculateWeedingQuote` + bloque de horas)

---

## 1. Flujo de reserva documentado

### Variables de precio que debe producir el flujo
(fuente: `garser-pricing-rules` §6.6 / §7.6)

| Variable del motor | Tipo | Fuente | Verificación |
|---|---|---|---|
| `weedingZones[].area` | m² (→ `precio_desbroce_m2` y `yield_m2_per_hour`) | **Cliente** (input, truco de pasos) | Aviso si >10.000 m²; el profesional verifica en persona (confirmación firmada) |
| `weedingZones[].state` | enum `normal` \| `dificultad_media` \| `dificultad_alta` → `suplementos.dificultad_media/alta` | **Cliente** (radio cards con descripciones) | — (decisión 100% del cliente) |
| `weedingZones[].applyHerbicide` | boolean → `precio_herbicida_m2` | **Cliente** (toggle opt-in, off por defecto) | Excluye jardineros sin tarifa de herbicida |
| `wasteRemoval` (global) | boolean → `suplementos.retirada_restos` | Cliente (toggle) | — |

**Bug corregido en esta revisión:** el bloque de horas del motor no aplicaba
`suplementos.retirada_restos` (el precio sí, vía `calculateWeedingQuote`) → con retirada
activa se bloqueaban **slots de menos** en el calendario del jardinero. Ahora horas y
precio escalan igual: `(area / yield) × estadoMult × retiradaMult`.

### Fase 1 — Input del cliente (formulario único, sin fotos)
- **Superficie (m²)**: input numérico con ayuda "cuéntala a pasos (1 paso ≈ 0,8 m) y
  multiplica largo × ancho".
- **Estado de la parcela**: 3 radio cards (Dificultad Normal / Media / Alta) con
  descripciones observables.
- **Aplicar herbicida**: toggle explícito, off por defecto ("requiere profesional
  certificado").
- **Retirada de restos**: toggle global.

### Fase 2 — Validación
- Aviso ámbar si superficie > 10.000 m² ("excede lo habitual en parcelas residenciales;
  el profesional verificará la medida en persona").
- Gate al continuar: superficie > 0 + estado válido + **checkbox de confirmación legal**
  ("acepto que el profesional podrá recalcular el precio en persona").

### Fase 3-4 — Análisis IA (reserva de SSOT, sin UI activa)
El prompt del edge queda reforzado y post-validado por si se reactiva el flujo con
fotos o para el modo QA (`weeding_prompt_quality_check`, 3 pasadas con métricas de
repetibilidad):
- Procedimiento con referencias de escala, estados operativos (<30 cm / 30–80 cm /
  leñoso >80 cm), plausibilidad 1–10.000 m² (fuera → nivel 2 + `AMBIGUOUS_SIZE` en
  `normalizeWeedingTask`), confidences + `referencia_escala`.
- Consolidación determinista de tareas múltiples: área = máximo (evita doble conteo),
  estado = el más severo, nivel = el peor.

### Fase 5 — Confirmación del cliente
El formulario ES la confirmación (todo lo introduce el cliente) + checkbox legal
obligatorio.

### Fase 6 — Handoff al motor de precios
```json
{
  "weedingZones": [
    { "id": "weeding-1", "area": 400, "state": "dificultad_alta", "applyHerbicide": false }
  ],
  "wasteRemoval": true
}
```
Fórmula (`calculateWeedingQuote`): `(area×precio_m2 + herbicida) × (1+dificultad%) ×
(1+retirada%)`, con `importe_minimo`. Exclusiones: sin `precio_desbroce_m2` o sin
`yield_m2_per_hour` → jardinero fuera; herbicida pedido sin `precio_herbicida_m2` →
jardinero fuera.

---

## 2. System prompt Gemini 2.5 Flash (SSOT, modo QA)

Config: `gemini-2.5-flash` · temperature 0 · topP 1 · topK 1 ·
`response_mime_type: application/json`.

- **Objetivo**: superficie consolidada de malas hierbas + estado.
- **Procedimiento**: deduplicar con anclas → escala (persona/puerta/valla/coche/cubo) →
  medir contorno excluyendo pavimento/edificios/césped mantenido → estado → confidences.
- **Estados operativos**: normal (hierba blanda <30 cm, suelo visible) ·
  dificultad_media (no leñosa 30–80 cm o densidad alta) · dificultad_alta (leñoso,
  zarzas, cañas o masa >80 cm que exige maquinaria pesada).
- **Plausibilidad**: 1–10.000 m²; fuera → nivel 2/3 + `AMBIGUOUS_SIZE`.
- **Confidence**: ≥0.9 medible con escala · 0.6–0.89 parcial · <0.6 suposición; sin
  escala → `superficie_confidence < 0.9`.

## 3. JSON schema + ejemplo

```json
{
  "tareas": [
    {
      "tipo_servicio": "Desbroce de malas hierbas",
      "estado_malas_hierbas": "dificultad_media",
      "estado_confidence": 0.85,
      "superficie_malas_hierbas_m2": 350,
      "superficie_confidence": 0.75,
      "referencia_escala": "coche ≈ 4,5 m",
      "nivel_analisis": 1,
      "observaciones": null
    }
  ]
}
```

---

## 4. Matriz de errores

| # | Fallo | Capa | Detección | Acción | Mensaje al cliente |
|---|---|---|---|---|---|
| E01 | Superficie vacía o 0 | Gate | `area <= 0` | Bloquear "Continuar" | "Completa la superficie y el estado de la parcela para continuar." |
| E02 | Sin confirmación legal | Gate | checkbox sin marcar | Bloquear "Continuar" | "Debes confirmar los datos del desbroce para continuar." |
| E03 | Superficie implausible | Formulario | `area > 10000` | Aviso ámbar (no bloquea; el profesional verifica) | "Más de 10.000 m² excede lo habitual en parcelas residenciales…" |
| E04 | Herbicida sin tarifa del jardinero | Motor | `applyHerbicide && !precio_herbicida_m2` | Excluir a ese jardinero | El cliente solo ve jardineros que cubren su solicitud |
| E05 | Config incompleta del jardinero | Motor | sin `precio_desbroce_m2` o `yield_m2_per_hour` | Excluir (`missing_pricing_config`/`missing_yield_config`) | — |
| E06 | (QA/futuro) superficie IA >10.000 | Edge (`normalizeWeedingTask`) | plausibilidad | nivel 2 + `AMBIGUOUS_SIZE` | Confirmación del cliente |
| E07 | (QA/futuro) tareas múltiples | Edge (`parseWeedingResult`) | consolidación | área=máx, estado=peor, nivel=peor | — |

---

## 5. Guía del cliente (Details Page)

Título in-app: "Datos de la parcela" — "Indica la superficie y el estado de la parcela
para calcular el presupuesto."

- **Superficie**: cuéntala a pasos (1 paso ≈ 0,8 m) y multiplica largo × ancho. No hace
  falta ser exacto al metro: el profesional la verificará en persona.
- **Estado**: elige el que mejor describa la parcela — Normal (hierba baja y blanda),
  Media (hierba alta no leñosa o densa), Alta (zarzas, leñoso, requiere maquinaria).
  El estado ajusta el precio: elegirlo bien evita recálculos in situ.
- **Herbicida**: actívalo solo si quieres prevenir rebrotes (lo aplica un profesional
  certificado y tiene coste adicional).
- **Confirmación**: marcas que los datos son correctos; si no lo fueran, el profesional
  podrá recalcular el precio en persona.
