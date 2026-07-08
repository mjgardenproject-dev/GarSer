# Plan de Testing — Poda de Palmeras, Árboles y Arbustos

**Fecha:** 2026-07-08  
**Rama:** `fix/audit-admin-settings`  
**PR:** [#7](https://github.com/mjgardenproject-dev/GarSer/pull/7)  
**Edge Deploy:** ✅ `ai-pricing-estimator` (cubre los 3 servicios)

---

## 1. Poda de Palmeras

**Docs:** [docs/analisis-ia-palmeras.md](./analisis-ia-palmeras.md)  
**Bug corregido:** Flujo de entrada manual no pedía estado (muy descuidado) → recargos nunca se aplicaban.

### Testing golden path (flujo analisis IA + checkout)

- [ ] **Crear reserva con foto**
  - Sube 2-3 fotos de una palmera (Phoenix, Trachycarpus u otra catalogada)
  - Una foto con referencia de escala (persona ~1,70 m junto al tronco)
  - IA debe detectar: especie, altura (±0,5 m tolerancia), estado

- [ ] **Validar resumen analisis**
  - Card muestra altura (input numérico) → **editable**
  - Card muestra especie (select con catálogo) → **confirmable**
  - Card muestra estado (chips: Normal / Descuidada / Muy descuidada) → **siempre seleccionable**

- [ ] **Editar campos post-analisis**
  - Cambiar altura en input (ej: 3.5 → 4.0 m)
  - Cambiar especie en select (ej: Phoenix → Trachycarpus)
  - Cambiar estado: seleccionar "Muy descuidada"
    - **Critical:** debe aparecer aviso "puede aplicar un recargo del profesional"

- [ ] **Gate al continuar**
  - Botón "Continuar" sin grupo analizado → bloqueado + toast error
  - Grupo analizado (nivel < 3) → "Continuar" habilitado

- [ ] **Checkout en ProvidersPage**
  - Elegir un jardinero que ofrezca la especie y altura
  - Validar precio:
    - Normal: según tarifa del jardinero
    - Muy descuidada: precio × (1 + condition_surcharges.muy_descuidado / 100)
    - Ej: Phoenix normal 50€, muy_descuidada 50€ × 1.5 = 75€ (si config.condition_surcharges.muy_descuidado = 50)

- [ ] **Entrada manual (flujo alternativo)**
  - En ProvidersPage o DetailsPage: opción "Entrar datos manualmente"
  - Wizard debe incluir:
    - Step 1: altura (slider 1-12 m)
    - Step 2: especie (cards con opciones)
    - **Step 3: estado (NEW)** — debe estar → Radio/Cards Normal / Descuidada / Muy descuidada
  - Crear reserva manual + ver precio con recargo si seleccionó Muy descuidada

### Testing edge cases

- [ ] **Altura implausible**
  - Foto de palmera >10 m de altura → IA devuelve `needs_review`
  - UI debe mostrar aviso ámbar en campo altura: "El profesional tendrá que verificar…"

- [ ] **Especie no catalogada**
  - Foto de palmera rara (no en el catálogo) → IA devuelve especie = null
  - UI: select muestra "No detectada"
  - Cliente puede seleccionar manualmente o reanalizar

- [ ] **Confianza baja en altura**
  - Foto sin referencia de escala clara → IA devuelve `altura_confidence < 0.8`
  - UI: aviso ámbar bajo input altura ("no había una referencia de escala clara")

- [ ] **Múltiples palmeras, cantidad > 1**
  - Foto con 3 palmeras idénticas (Phoenix medium)
  - IA propone: aiDetectedCount = 3, aiDetectedSummary = "3× Phoenix medium"
  - Cliente confirma cantidad en stepper
  - Precio = (precio_1_palmera × 3), horas = (horas_1_palmera × 3)

- [ ] **Reanalizar**
  - Card analizado + botón "Reanalizar esta zona"
  - Subir foto nueva, click reanalizar
  - Resultado nuevo debe reemplazar el anterior

### Testing regresión (features existentes no deben romperse)

- [ ] Cambiar service desde otro (ej: Corte de Cesped → Poda de Palmeras)
  - Datos antiguos no deben quedar en contexto
  - serviceIds debe actualizar correctamente
  - palmGroups vacío al empezar nuevo servicio

- [ ] Foto corrupta o inválida
  - File picker: rechaza formato no soportado (solo JPEG/PNG)
  - Foto <100 KB o >50 MB: toast error + explicación

- [ ] Cambio de idioma
  - Si hay i18n: labels, hints y avisos deben traducirse

---

## 2. Poda de Árboles

**Docs:** [docs/analisis-ia-arboles.md](./analisis-ia-arboles.md)  
**Bug corregido:** `pruningType` quedaba fijado a "estructural" sin preguntar → tarifa formación nunca se aplicaba.

### Testing golden path (flujo analisis IA + checkout)

- [ ] **Crear reserva con foto**
  - Sube 2-3 fotos de un árbol (altura medium esperada, ej: 4-5 m)
  - Una foto con referencia de escala (persona/puerta junto al tronco)
  - IA debe detectar: altura_m (~4.5 m), size_band = "medium"

- [ ] **Validar resumen analisis**
  - Card muestra altura (input numérico) → **editable, con confidence visible si <0.8**
  - Card muestra tamaño (select: Pequeño/Mediano/Grande/>9m) → **confirmable**
  - Card muestra tipo de poda (chips: "Poda de formación" / "Poda estructural") → **CRITICAL: SIEMPRE VISIBLE Y EDITABLE**
    - Antes del fix: fijaba Estructural sin preguntar (BUG)
    - Después del fix: 2 chips, cliente elige

- [ ] **Editar campos post-analisis**
  - Cambiar altura en input
  - Cambiar tamaño en select (ej: medium → large)
  - **Cambiar tipo de poda: clickear "Poda de formación"**
    - Precio debe cambiar (formación más barata que estructural para el mismo tamaño)
    - Horas deben cambiar (yield distinto por tipo)

- [ ] **Responder pregunta de acceso (GATE OBLIGATORIO)**
  - Card: "¿Hay acceso fácil al árbol?"
  - Sí / No — radio buttons obligatorio
  - "Continuar" bloqueado si algún árbol no tiene respuesta
  - Si Sí: no hay recargo
  - Si No: aplica `difficultyIncrease` % (si config lo define)

- [ ] **Cantidad: flujo de múltiples árboles idénticos**
  - Foto de 3 árboles mediano juntos
  - IA propone: aiDetectedCount = 3, aiDetectedSummary = "3× Mediano (3-5m)"
  - Card: banner "La IA ha detectado 3 árboles… Confirma cuántos quieres podar"
  - Stepper: cambiar de 1 a 3
  - Precio = precio_1_arbol × 3, horas = horas_1_arbol × 3

- [ ] **Checkout en ProvidersPage**
  - Elegir jardinero
  - Si tamaño = large o over_9: aviso permanente "El profesional tendrá que verificar el pago…"
  - Validar precio:
    - Formación mediano, cantidad 1: 80€
    - Formación mediano, cantidad 3: 240€
    - Formación mediano, sin acceso difícil: 80€
    - Formación mediano, acceso difícil (dificultad_alta = true): 80€ × (1 + difficultyIncrease/100)

### Testing edge cases

- [ ] **Altura >40 m (implausible)**
  - Foto de árbol muy alto → IA devuelve altura = 45 m
  - Post-validación edge: altura > 40 → nivel = 2 + AMBIGUOUS_SIZE
  - UI: aviso ámbar "Revisa el tamaño…"

- [ ] **Tamaño large (5-9 m)**
  - Foto de árbol ~6 m
  - UI: mismo flujo normal
  - Checkout: aviso "muy complejo"
  - Jardinero sin config.large → excluido (missing_yield_config)

- [ ] **Tamaño over_9 (>9 m)**
  - Foto de árbol muy alto (~12 m)
  - IA propone size_band = over_9
  - UI: mostrar size_band = over_9 en select
  - Motor: usa precio y yield de `large` (es escalón superior)
  - Aviso: "El profesional tendrá que verificar el pago…"

- [ ] **Acceso difícil: cambiar respuesta**
  - Inicialmente: "Sí, hay acceso fácil"
  - Cambiar a: "No, acceso difícil"
  - Precio debe actualizar: precio × (1 + difficultyIncrease / 100)

- [ ] **Confianza baja en tamaño**
  - Foto sin referencia clara → tamaño_confidence < 0.8
  - UI: aviso ámbar bajo select tamaño

- [ ] **Reanalizar con cambio de cantidad**
  - Primer análisis: detecció 2 árboles, confirmaste 2
  - Reanalizar: nueva foto, deteceta 4 árboles
  - Stepper debe resetear a 1 (client decide de nuevo)

### Testing regresión

- [ ] Cambio de tipo de poda debe actualizar horas estimadas
- [ ] Cambio de acceso debe actualizar precio en tiempo real
- [ ] Validación: no permitir continuar sin responder acceso

---

## 3. Poda de Plantas y Arbustos

**Docs:** [docs/analisis-ia-arbustos.md](./analisis-ia-arbustos.md)  
**Bug crítico corregido:** campo `state` no existía en ninguna capa → recargos `condition_surcharges` nunca se aplicaban (infracobro crónico).

### Testing golden path (flujo analisis IA + checkout)

- [ ] **Crear reserva con foto**
  - Sube 2-3 fotos de un macizo de plantas (ej: rosales, boj, laurel)
  - Una foto con referencia de escala (silla, cubo de basura)
  - IA debe detectar: superficie_m2 (~12 m²), tamaño = medianas, estado (normal/descuidado/muy_descuidado)

- [ ] **Validar resumen analisis**
  - Card muestra superficie (input numérico) → **editable, con confidence visible si <0.8**
  - Card muestra tamaño (select: Pequeñas/Medianas/Grandes) → **confirmable**
  - Card muestra estado (chips: Normal / Descuidadas / Muy descuidadas) → **CRITICAL**
    - Si IA propuso ≠ normal: debe haber aviso "puede aplicar un recargo del profesional"
    - Estado siempre editable

- [ ] **Editar campos post-analisis — CRITICAL TEST**
  - Cambiar superficie: 12 → 15 m²
  - Cambiar tamaño: medianas → grandes
  - **Cambiar estado: Normal → "Muy descuidadas"**
    - **Aviso debe aparecer:** "Estado propuesto por la IA según tus fotos. Puede aplicar un recargo del profesional: confírmalo o corrígelo."
    - Hasta que toque el control, `stateProposedByAI = true`
    - Una vez tocado, `stateProposedByAI = false`

- [ ] **Gate al continuar**
  - Rechaza si: ningún grupo analizado o grupo con `area = 0`
  - Toast: "Analiza al menos un grupo de plantas con superficie válida para continuar."

- [ ] **Checkout en ProvidersPage — RECARGO VALIDATION**
  - Elegir jardinero
  - Validar precio:
    - **Base:** 10 m² medianas × 4 €/m² = 40€
    - **Normal:** 40€
    - **Descuidadas (state = descuidado):** 40€ × (1 + 20/100) = 48€
    - **Muy descuidadas (state = muy_descuidado):** 40€ × (1 + 50/100) = 60€
  - Horas también deben escalar:
    - Base: 10 m² ÷ 20 m²/h = 0.5 h
    - Muy descuidadas: 0.5 h × (1 + 50/100) = 0.75 h → redondeo a 1 h

- [ ] **Entrada manual (flujo alternativo)**
  - Wizard debe tener 3 steps:
    - Step 1: superficie (slider 1-2000 m²)
    - Step 2: tamaño dominante (cards: Pequeñas/Medianas/Grandes)
    - **Step 3: estado (NEW)** — cards Normal / Descuidadas / Muy descuidadas
  - Crear reserva manual, validar precio con recargo

### Testing edge cases

- [ ] **Superficie >500 m² (implausible)**
  - Foto de macizo enorme (o error de medida) → IA propone 600 m²
  - Post-validación edge: >500 m² → nivel = 2 + AMBIGUOUS_SIZE
  - UI: aviso ámbar "Revisa la superficie…"

- [ ] **Confianza baja en superficie**
  - Foto sin referencia de escala → superficie_confidence < 0.8
  - UI: aviso ámbar bajo input superficie

- [ ] **Confianza baja en tamaño**
  - Foto de follaje poco visible → tamano_confidence < 0.8
  - UI: aviso ámbar bajo select tamaño

- [ ] **Múltiples macizos: un grupo por cada uno**
  - 3 macizos distintos en el jardín: crear 3 grupos
  - Cada uno analizado de forma independiente
  - Checkout suma todos: precio total = grupo1 + grupo2 + grupo3

- [ ] **Mezcla de estados en múltiples grupos**
  - Grupo 1: 10 m² medianas, Normal → 40€
  - Grupo 2: 5 m² medianas, Muy descuidadas → 5 × 4 × 1.5 = 30€
  - Total: 70€

- [ ] **Reanalizar**
  - Card analizado + botón "Reanalizar esta zona"
  - Subir foto nueva, estado distinto propuesto
  - Client debe confirmar nuevo estado

### Testing regresión — RECARGO ACTIVATION (core)

- [ ] Activar globalmente "Retirada de restos"
  - Precio debe multiplicarse por (1 + waste_removal.percentage / 100)
  - También afecta horas

- [ ] Cambiar estado en card + checkout
  - Editar estado: normal → descuidado
  - Ir a ProvidersPage, ver precio actualizado

- [ ] Jardinero sin configuración para tamaño
  - Solicitar "Grandes" pero jardinero no tiene `prices_per_m2.grandes`
  - Jardinero debe excluirse (missing_pricing_config)

---

## Test Environment Setup

### Pre-requisites

1. **Rama:** `fix/audit-admin-settings`
2. **Tests locales:** `npm test` (verify 333/333 passing)
3. **Type check:** `npx tsc --noEmit` (verify clean)
4. **Edge function:** ✅ deployed (`supabase functions deploy ai-pricing-estimator`)

### Browser Testing

1. **Service selection:** Go to `/reserva` or create new booking
2. **Select service:** Poda de Palmeras / Poda de Árboles / Poda de Plantas y Arbustos
3. **Follow golden path** above

### Debug Tools

- Browser console: check for errors in `estimateWorkWithAI`
- Network tab: verify `ai-pricing-estimator` edge function responses
- React DevTools: inspect `BookingContext` state, `palmGroups`/`treeGroups`/`shrubGroups`
- Supabase Dashboard: check edge function logs

---

## Acceptance Criteria (must all pass for merge)

### Palmeras
- ✅ Altura propuesta ±0,5 m con escala
- ✅ Estado editable (chips), recargo aplicado en checkout
- ✅ Entrada manual con pregunta de estado
- ✅ Altura >10m triggers needs_review warning

### Árboles
- ✅ Tipo de poda **ALWAYS EDITABLE** (formación/estructural) — BUG FIXED
- ✅ Tamaño confirmable, quantity multiplicador precio×horas
- ✅ Acceso difícil pregunta obligatoria con recargo visible
- ✅ Altura >40m triggers review, over_9 usa precio de large

### Arbustos
- ✅ Estado propuesto por IA, cliente confirma con aviso recargo — **CRITICAL**
- ✅ Recargo `condition_surcharges` aplicado en checkout (normal/descuidado/muy_descuidado)
- ✅ Superficie editable, tamaño confirmable
- ✅ Entrada manual con pregunta de estado
- ✅ Gate al continuar: rechaza si no hay grupo válido con area > 0

---

## Next Steps (after merge)

1. Merge PR → main
2. Deploy a staging (si existe)
3. Run full E2E tests (si existen)
4. Prepare **Setos, Césped, Desbroce, Fitosanitarios** auditoría (lista de bugs a revisar por servicio)

