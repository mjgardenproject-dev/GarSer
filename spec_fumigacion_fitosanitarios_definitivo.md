# SPEC DEFINITIVO — Servicio "Fumigación y Tratamientos Fitosanitarios"

## 0) Objetivo y alcance

Implementar el flujo completo del servicio **Fumigación y Tratamientos Fitosanitarios** en 3 capas:

1. Configuración de precios del jardinero (modelo de datos + UI).
2. Flujo cliente + análisis Vision AI.
3. Motor de cálculo de presupuesto desglosado.

Este documento está preparado para ejecución por fases, con puntos de control para pausar y retomar sin perder contexto.

---

## 1) Criterios funcionales cerrados (definición final)

### 1.1 Bloques de tarificación obligatorios

- **Tarifa base**
  - `importe_minimo` (EUR).

- **Tratamientos transversales**
  - `insecticida`
  - `fungicida`
  - `herbicida`
  - `ecologico_preventivo`

- **Matrices de precio por bloque**
  - **Superficies y Plantas (€/m²):**
    - tramos: `hasta_100m2`, `mas_de_100m2`
    - tratamientos permitidos: los 4
  - **Setos (€/metro lineal):**
    - tramos: `hasta_2m`, `mas_de_2m`
    - tratamientos permitidos: todos menos `herbicida`
  - **Árboles (€/unidad):**
    - tramos: `hasta_3m`, `mas_de_3m`
    - tratamientos permitidos: todos menos `herbicida`
  - **Palmeras (€/unidad):**
    - tradicional: `hasta_3m`, `mas_de_3m`
    - endoterapia: precio único por unidad (sin tramo)

### 1.2 Flujo cliente obligatorio

- 2 fotos obligatorias:
  - 1 panorámica
  - 1 detalle del problema
- 2 preguntas de escala:
  - m² aproximados de zona
  - si la vegetación supera 3m

### 1.3 Cálculo final obligatorio

- Extraer tratamiento recomendado por IA.
- Cruzar IA + inputs cliente + configuración jardinero.
- Devolver presupuesto desglosado:
  - líneas de item
  - subtotal por línea
  - total
  - aplicación de `importe_minimo` si procede

---

## 2) Carencias detectadas en la propuesta original

1. No define cómo versionar la configuración para evitar romper configuraciones antiguas.
2. No define reglas de fallback cuando la IA tiene baja confianza o ambigüedad.
3. No define reglas de compatibilidad estricta tratamiento/bloque en tiempo de cálculo.
4. No define contrato JSON estricto IA ↔ frontend ↔ motor de cálculo.
5. No define estrategia de deduplicación cuando varias fotos detectan el mismo elemento.
6. No define comportamiento de “endoterapia” frente a recomendación general de tratamiento.
7. No define estados de validación para activar/desactivar el servicio del jardinero.

---

## 3) Soluciones definitivas a carencias

1. **Versionado de config**
   - Guardar en `additional_config` un objeto con `version: "fumigation_v2"`.
   - Mantener compatibilidad con config anterior solo para lectura; nueva edición siempre migra a v2.

2. **Fallback por confianza IA**
   - Si `confidence < umbral` o `tratamiento_recomendado = "inconclusive"`, bloquear auto-presupuesto y pedir confirmación manual.
   - Umbral recomendado: `0.65`.

3. **Matriz de compatibilidad centralizada**
   - Tabla lógica única en código:
     - `herbicida` prohibido en setos y árboles.
     - `endoterapia` solo en palmeras.
   - Validación doble: en UI de jardinero y en cálculo backend/frontend.

4. **Contrato JSON estricto**
   - Definir DTO tipado + esquema de validación para:
     - respuesta IA
     - configuración jardinero v2
     - resultado de presupuesto
   - Rechazar respuesta IA que no cumpla contrato.

5. **Deduplicación multi-foto**
   - Agrupar detecciones por tipo + rango + proximidad visual estimada.
   - Aplicar “merge conservador” para evitar doble conteo.

6. **Regla de prioridad terapéutica**
   - Si IA recomienda endoterapia y detecta palmeras aptas, se calcula endoterapia para palmeras.
   - Resto de elementos (si existen) se calcula con el tratamiento principal compatible.

7. **Activación del servicio**
   - El servicio solo puede marcarse activo si:
     - `importe_minimo > 0`
     - al menos un tratamiento configurado
     - todos los campos obligatorios de cada bloque habilitado son > 0

---

## 4) Diseño técnico final (sin ejecutar cambios aún)

### 4.1 Base de datos

No se crean tablas nuevas. Se reutiliza `gardener_service_prices.additional_config` con estructura JSON v2.

Estructura objetivo en `additional_config`:

```json
{
  "version": "fumigation_v2",
  "importe_minimo": 120,
  "tratamientos_activos": ["insecticida", "fungicida", "ecologico_preventivo"],
  "superficies_plantas": {
    "hasta_100m2": { "insecticida": 2.4, "fungicida": 2.7, "herbicida": 1.9, "ecologico_preventivo": 2.2 },
    "mas_de_100m2": { "insecticida": 1.9, "fungicida": 2.1, "herbicida": 1.5, "ecologico_preventivo": 1.8 }
  },
  "setos": {
    "hasta_2m": { "insecticida": 3.1, "fungicida": 3.3, "ecologico_preventivo": 2.9 },
    "mas_de_2m": { "insecticida": 4.0, "fungicida": 4.4, "ecologico_preventivo": 3.6 }
  },
  "arboles": {
    "hasta_3m": { "insecticida": 12, "fungicida": 13, "ecologico_preventivo": 11 },
    "mas_de_3m": { "insecticida": 18, "fungicida": 19, "ecologico_preventivo": 16 }
  },
  "palmeras": {
    "tradicional": { "hasta_3m": 15, "mas_de_3m": 24 },
    "endoterapia": { "precio_unico": 36 }
  }
}
```

### 4.2 Frontend cliente (reserva)

- Paso de fotos: validar mínimo 2 imágenes (panorámica + detalle).
- Preguntas de escala obligatorias antes de lanzar IA.
- Guardar inputs y resultado IA en estado de reserva por servicio.
- Si IA no confiable: mostrar aviso y derivar a revisión/manual.

### 4.3 Endpoint IA (edge function)

- Soporte explícito multi-imagen.
- Prompt deterministic-first:
  - salida JSON pura
  - sin texto adicional
  - esquema fijo
- Respuesta con:
  - `tratamiento_recomendado`
  - `confidence`
  - `elementos_detectados[]` por tipo y tramo
  - `flags_de_riesgo` (ambiguo, mala iluminación, etc.)

### 4.4 Motor de cálculo

- Entrada:
  - config jardinero v2
  - IA normalizada y validada
  - inputs cliente
- Salida:
  - items calculados por bloque
  - total bruto
  - ajuste por `importe_minimo`
  - total final
  - metadatos de cobertura/limitaciones

---

## 5) System prompt definitivo (en inglés, repetible, multi-image)

```text
You are a deterministic vision-analysis engine for a gardening marketplace.

TASK:
Analyze one or more user photos to estimate fumigation/plant-treatment needs.
Use only visible evidence. Do not invent unseen facts.

OUTPUT RULES (STRICT):
1) Return valid JSON only.
2) No markdown, no explanations, no extra keys.
3) Follow the exact schema below.
4) If uncertain, lower confidence and use conservative counts.
5) If evidence is insufficient, set recommended_treatment to "inconclusive".

SCHEMA:
{
  "recommended_treatment": "insecticida" | "fungicida" | "herbicida" | "ecologico_preventivo" | "endoterapia" | "inconclusive",
  "confidence": number, 
  "detected_elements": {
    "surfaces_plants": { "present": boolean, "estimated_severity": "low" | "medium" | "high" | "unknown" },
    "hedges": { "count": number, "height_bands": { "hasta_2m": number, "mas_de_2m": number } },
    "trees": { "count": number, "height_bands": { "hasta_3m": number, "mas_de_3m": number } },
    "palms": {
      "count": number,
      "height_bands": { "hasta_3m": number, "mas_de_3m": number },
      "endotherapy_candidate_count": number
    }
  },
  "risk_flags": string[],
  "notes_for_calculation": {
    "possible_duplicate_views": boolean,
    "visibility_limitations": string[]
  }
}

DETECTION POLICY:
- Deduplicate objects that likely appear in multiple photos.
- Never exceed visually plausible counts.
- If object type is unclear, do not force classification.
- Herbicide should be recommended only when weed-dominant ground/area evidence is clear.
- Endotherapy should be recommended only when palm-specific trunk treatment signs/needs are plausible.

CONFIDENCE POLICY:
- 0.85-1.00: clear evidence, low ambiguity
- 0.65-0.84: moderate certainty
- <0.65: weak certainty, likely inconclusive

Return JSON only.
```

---

## 6) Sugerencias extra para mejorar UX, fiabilidad y confianza

1. Mostrar “por qué” del presupuesto con un desglose visible por bloque y tratamiento.
2. Incluir etiqueta de calidad del análisis (`alta`, `media`, `baja`) para transparencia.
3. Permitir corrección manual rápida del cliente (conteos y tramos) antes de confirmar.
4. Avisar al cliente cuando la foto no es válida (borrosa, sin contexto, distancia insuficiente).
5. En panel jardinero, simulador con casos tipo para verificar su matriz de precios antes de guardar.
6. Registrar métricas de discrepancia IA vs ajustes manuales para mejorar el prompt con datos reales.

---

## 7) Plan de implementación por fases (resumible)

## Fase 1 — Contratos y validaciones base

**Objetivo:** cerrar tipados y reglas comunes antes de tocar flujo.

Checklist:
- [ ] Definir tipos TS para config v2, respuesta IA y quote.
- [ ] Definir esquemas de validación runtime para esos 3 contratos.
- [ ] Añadir validación de compatibilidad tratamiento/bloque.
- [ ] Añadir función de validación de activación del servicio.

Entregable de fase:
- Contratos listos y reutilizables por UI, endpoint y cálculo.

Punto de reanudación:
- Si se pausa, reanudar desde el primer ítem no marcado.

## Fase 2 — Persistencia de configuración jardinero

**Objetivo:** guardar y cargar config v2 sin romper lo existente.

Checklist:
- [ ] Adaptar lectura/escritura de `additional_config` al formato `fumigation_v2`.
- [ ] Incorporar migración de lectura desde formato anterior (si existe).
- [ ] Bloquear activación si la validación no pasa.

Entregable de fase:
- Configuración estable persistida en DB y válida para cálculo.

Punto de reanudación:
- Reanudar por ítem pendiente, sin tocar fases posteriores.

## Fase 3 — UI de configuración del jardinero

**Objetivo:** interfaz completa con matriz cruzada y reglas de negocio.

Checklist:
- [ ] Render de tarifa base.
- [ ] Render de tratamientos transversales.
- [ ] Render de 4 bloques de tarificación con sus tramos.
- [ ] Bloqueos de combinaciones no permitidas.
- [ ] Validaciones inline y guardado seguro.

Entregable de fase:
- UI usable end-to-end para configurar precios reales.

Punto de reanudación:
- Reanudar por el bloque de UI pendiente.

## Fase 4 — Flujo cliente + análisis IA

**Objetivo:** captura correcta de datos + análisis reproducible.

Checklist:
- [ ] Exigir 2 fotos obligatorias.
- [ ] Exigir 2 preguntas de escala.
- [ ] Integrar llamada a endpoint con prompt definitivo.
- [ ] Validar contrato JSON de respuesta IA.
- [ ] Manejar estado “inconclusive” y baja confianza.

Entregable de fase:
- Flujo cliente robusto y respuesta IA estructurada.

Punto de reanudación:
- Reanudar en la primera validación o paso de UI pendiente.

## Fase 5 — Motor de presupuesto

**Objetivo:** cálculo final desglosado y consistente con reglas.

Checklist:
- [ ] Implementar algoritmo de cruce IA + inputs + config.
- [ ] Aplicar matriz de compatibilidad.
- [ ] Aplicar `importe_minimo`.
- [ ] Devolver items, subtotales, total y metadatos.
- [ ] Cubrir casos borde con pruebas unitarias.

Entregable de fase:
- Cálculo fiable y auditado por tests.

Punto de reanudación:
- Reanudar por test/caso pendiente hasta verde completo.

## Fase 6 — Integración en selección de proveedores

**Objetivo:** usar el quote para ranking/visualización de jardineros.

Checklist:
- [ ] Integrar cálculo en flujo de listado de proveedores.
- [ ] Mostrar cobertura parcial/no compatible de forma explícita.
- [ ] Evitar mostrar importes no confiables sin advertencia.

Entregable de fase:
- Presupuesto visible y consistente durante la elección de proveedor.

Punto de reanudación:
- Reanudar por regla de cobertura pendiente.

## Fase 7 — Validación final técnica

**Objetivo:** asegurar que todo el flujo queda estable.

Checklist:
- [ ] Ejecutar pruebas del proyecto relevantes.
- [ ] Ejecutar lint.
- [ ] Ejecutar typecheck.
- [ ] Verificar casos manuales clave de extremo a extremo.

Entregable de fase:
- Implementación validada para despliegue controlado.

Punto de reanudación:
- Reanudar por el primer chequeo técnico pendiente.

---

## 8) Definición de “hecho” (DoD)

Se considera terminado cuando:

1. Jardinero puede configurar y guardar matriz v2 válida.
2. Cliente completa flujo con 2 fotos + 2 preguntas.
3. IA devuelve JSON válido y determinista bajo el contrato.
4. Motor calcula quote desglosado aplicando reglas y mínimo.
5. Proveedores muestran presupuesto/cobertura con transparencia.
6. Lint, typecheck y pruebas relevantes pasan en verde.

