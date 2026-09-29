# Plan de implementación — Formularios manuales de la reserva (2026-09-29)

**Origen**: auditoría UX/UI del 2026-09-29 (ver [`README.md`](README.md) para los IDs de
hallazgos y las decisiones D1–D8).

**Estándar a seguir**: [`docs/design-system.md`](../../design-system.md). Lo que esta ronda
añada al sistema (patrones de formulario) se incorpora a ese documento en la Fase 6.

**Forma de trabajar**

1. Una fase = un PR (o una serie de commits revisables en la rama de la ronda).
2. Ninguna fase empieza sin tu aprobación de la anterior.
3. Toda fase que cambie la web termina con la **puerta de prueba local** (abajo). Si algo
   falla, la fase no se da por cerrada.
4. Lo que se descubra por el camino va a [`HALLAZGOS-NUEVOS.md`](HALLAZGOS-NUEVOS.md), no se
   arregla de paso salvo que sea imprescindible para la fase y se diga en el commit.
5. [`PROGRESO.md`](PROGRESO.md) se actualiza en el mismo commit que el cambio que describe.

---

## Qué no se toca en ninguna fase

- `src/shared/manualEntry/manualEntrySchema.ts`, `manualEntryValidation.ts` y `legalCopy.ts`.
  Los importan **dos Edge Functions** (`booking-authority` y `booking-manual-declaration`):
  cambiarlos es cambiar el servidor. **Única excepción: D1** (Fase 4.3-D1).
- `src/pages/reserva/manualEntryBuilders.ts` (excepción: D1).
- `bookingQuoteCore.ts`, `src/domain/**`, Edge Functions, migraciones y Supabase.
- `handleManualSubmit`, la forma de `manualDraft = { items, wasteRemoval }`, el payload de
  `onSubmit`, los `stepId` de telemetría y el texto, versión y hash del consentimiento.
- Valores de opción, rangos (`MANUAL_RANGES`), `defaultValue` y la semántica de
  `visibleWhen` / `dynamicOptions`.
- No se añaden valores por defecto nuevos ni se borran respuestas de campos ocultos.

---

## Puerta de prueba local (obligatoria al cerrar cada fase que cambie la web)

Se ejecuta completa, se apunta el resultado en `PROGRESO.md` y se te envían las capturas
antes de pedir aprobación.

### Nivel A · Comprobaciones automáticas

| Comprobación | Comando | Criterio |
|---|---|---|
| Tipos | `npx tsc -p tsconfig.app.json --noEmit` | Sin errores |
| Lint de los archivos tocados | `npx eslint <archivos>` | Sin errores nuevos |
| Tests completos | `npx vitest run` | Todo en verde |
| **Paridad de precio** | `npx vitest run src/pages/reserva/manualEntryPricingParity.test.ts` | Snapshots **idénticos** (salvo el cambio esperado y documentado de D1) |
| Tests de la entrada manual | `npx vitest run src/shared/manualEntry/ src/pages/reserva/manualEntryBuilders.test.ts src/pages/reserva/manualCorrectionRecompute.test.ts src/components/booking/manual/` | Todo en verde; ningún test de lógica modificado |
| Compilación de producción | `npx vite build` | Compila |

### Nivel B · Banco de pruebas visual (componentes reales)

Renderiza `ManualEntryChoice` y `ManualEntryWizard` reales dentro de la misma cabecera de
«Detalles» y recorre los 7 servicios con Playwright (se crea en la Fase 0, en
`scripts/qa/manual-entry/`, fuera de `src` y fuera del build).

- Anchos: 320, 360, 375, 414, 768 y 1280 px.
- Criterios automáticos por pantalla: `scrollWidth ≤ viewport`; el CTA principal dentro del
  viewport a 375×667; controles interactivos ≥ 44 px de alto; sin errores de consola.
- Casos fijos: recorrido completo de cada servicio; error de validación; añadir + volver
  atrás en repetibles; cambiar de especie tras elegir altura; fito con cada tipo de
  vegetación y curativo/preventivo; teclado (Tab, flechas, Intro); coma decimal.
- El payload de `onSubmit` de cada recorrido se compara con el fixture de la Fase 0.
- Capturas antes/después a 375 px de cada pantalla afectada, enviadas en el mensaje de cierre.

### Nivel C · Aplicación real en local

`npm run dev` con `VITE_ENABLE_MANUAL_BOOKING_INPUT=true`, recorriendo servicios → dirección →
detalles → profesionales.

- Requiere `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en el entorno (son valores
  públicos, los mismos que lleva el bundle de producción) y acceso de red a Supabase. Hoy el
  entorno no los tiene: si no se configuran, este nivel se marca como **no ejecutado** en
  `PROGRESO.md` y se dice en el cierre de fase.
- Contra el Supabase de producción, **solo sin iniciar sesión** y **sin pasar de la pantalla
  de profesionales**: con sesión, el envío escribe una declaración real en
  `booking_manual_declarations`.
- Criterio: el precio que muestra cada profesional para los mismos datos es el mismo que
  con `main` (se ejecutan las dos versiones y se comparan).

### Nivel D · Prueba en tu móvil (tuya)

Si Vercel genera despliegues de vista previa por rama, se te pasa el enlace y la lista de
cosas a probar en iOS Safari / Android Chrome. Si no, se omite y se hace en la Fase 7.

**Cierre de fase**: resumen de cambios, resultados A–D, capturas, hallazgos nuevos y pregunta
explícita de aprobación para la siguiente fase.

---

## Cómo se garantiza que el precio no cambia

En la Fase 0 se congelan **respuestas de referencia** por servicio que cubren todas las
ramas condicionales. Para cada una se guarda como snapshot:

1. el `patch` de `buildManualBookingPatch` (sin ids ni fechas), y
2. el presupuesto de `buildAuthoritativeBookingQuote` con una configuración de jardinero de
   prueba (precio, horas, desglose).

Además, el banco visual recorre la interfaz con esas mismas respuestas y comprueba que
`onSubmit` recibe un payload idéntico. Si un snapshot cambia sin estar previsto, la fase se
detiene.

---

## Fase 0 — Línea base y herramientas

- **Objetivo**: poder demostrar en cada fase que el precio no cambia.
- **Archivos**: `src/pages/reserva/manualEntryPricingParity.test.ts` (nuevo), fixtures,
  `scripts/qa/manual-entry/` (banco visual, nuevo). Ningún archivo de producción.
- **Cambios**:
  - Fixtures por servicio: césped (normal/descuidado/muy descuidado); setos (1 y 2 caras,
    alturas 1,9 / 2,0 / 2,1 / 4,0 / 4,1 m); árboles (4 tamaños × 2 podas × acceso, 1 y 3
    árboles); palmeras (cada especie, tramo bajo y tramo abierto, con y sin extras, 2
    grupos); arbustos (3 × 3); fito (5 tipos × preventivo/curativo × 3 objetivos,
    ecológico, seto alto, endoterapia, 2 zonas); desbroce (3 dificultades × herbicida).
  - Snapshots generados sobre `main` sin cambios.
  - Banco visual y capturas de referencia.
- **Riesgo**: fixtures incompletos. Mitigación: tabla de ramas cubiertas en el propio test.
- **Aceptación**: snapshots en verde sobre el código actual; banco visual reproduce los
  hallazgos V1, S-SET-1 y S-ARB-1.
- **Prueba local**: Nivel A (sin cambios en la web no hay Niveles B–D que comparar).

## Fase 1 — Correcciones críticas (sin rediseño)

- **Objetivo**: quitar ya lo que cobra mal, bloquea o recorta. Publicable por sí sola.
- **Archivos**: `ManualFieldRenderer.tsx`, `ManualEntryWizard.tsx`, `ManualEntrySummary.tsx`,
  `manualEntryIcons.test.ts`, nuevo `manualEntryPresentation.ts` (mínimo: sustantivos y
  unidades).
- **Cambios, en este orden**:
  1. S-SET-1: el stepper se ajusta a la rejilla de `step` (0,5 → 1,0 → 1,5 → 2,0…).
  2. S-ARB-1, S-PAL-1, S-FIT-1: al volver atrás desde el primer paso de un elemento vacío,
     se descarta; no se llega al resumen con elementos incompletos; «Eliminar» en el
     resumen (nunca el último elemento).
  3. V1: opciones en una columna por debajo de `md`; `min-w-0` y `break-words`.
  4. S-FIT-2: unidad visible en «Cantidad a tratar» según `affectedType` (m², m o ud).
  5. V2: entrada numérica de texto con `inputmode` adecuado y coma aceptada.
  6. S-REP-1 y S-FIT-3: plurales correctos; registrar `TreePalm`; el test del registro
     recorre cada `affectedType`.
- **Riesgo**: los puntos 1 y 2 cambian lo que se envía en casos límite (es la corrección).
  Tests nuevos del caso fantasma y del ajuste a los límites 2,0 y 4,0 m.
- **Aceptación**: 0 desbordes de 320 a 1280 px; imposible enviar un elemento vacío; cuatro
  toques de «+» en la altura del seto dan 2,0 m; «1,5» aceptado; paridad en verde.
- **Prueba local**: Niveles A, B, C (si hay credenciales) y D (si hay vista previa).

## Fase 2 — Componentes compartidos y capa de presentación

- **Objetivo**: construir las piezas del sistema sin cambiar todavía el recorrido.
- **Archivos**: `components/booking/manual/fields/` (`FormField`, `MeasureInput`,
  `QuantityStepper`, `ChoiceList`, `SegmentedChoice`, `SwitchRow`, `ContextualHelp`,
  `FieldError`); `manualEntryPresentation.ts` completo; `ManualFieldRenderer` delega en ellos.
- **Cambios**: cada campo se dibuja con su componente según la capa de presentación; tests
  unitarios de cada componente (teclado, `aria-*`, coma decimal, ajuste a la rejilla).
- **Riesgo**: tests que buscan `spinbutton` o textos concretos se actualizan (presentación,
  no lógica).
- **Aceptación**: mismo tipo de valor emitido por cada control; todos los controles ≥ 44 px;
  axe sin violaciones en los componentes; paridad en verde.
- **Prueba local**: Niveles A–D.

## Fase 3 — Estructura del asistente y navegación

- **Objetivo**: contexto claro, un solo progreso, CTA fijo y validación correcta.
- **Archivos**: `ManualEntryWizard.tsx` (estructura), `ManualEntryChoice.tsx` (control
  segmentado), `DetailsPage.tsx` (solo el hueco del asistente y la barra fija compartida),
  `strings.ts`.
- **Cambios**: pantallas agrupadas según la capa de presentación (se sigue emitiendo
  `onStepComplete` por cada `stepId` del esquema); línea de contexto con el servicio y
  «n de N» estable; «Siguiente» nunca deshabilitado salvo durante el envío; foco al primer
  error; Intro avanza; sin «Atrás» en la primera pantalla; una sola pista de precio.
- **Riesgo**: campos condicionales que cambian en vivo dentro de una pantalla; telemetría;
  el panel del jardinero reutiliza el asistente.
- **Aceptación**: CTA siempre visible a 375×667; servicio visible en todas las pantallas;
  mismos eventos e ids de telemetría en un recorrido completo; corrección del jardinero
  funciona; paridad en verde.
- **Prueba local**: Niveles A–D, más recorrido de la corrección del jardinero en el banco.

## Fase 4 — Rediseño por servicio

Cada servicio es un paso independiente, con su propia puerta de prueba local y su propia
aprobación. Solo cambia `manualEntryPresentation.ts` (y, en 4.3-D1, lo indicado).

| Paso | Servicio | Pantallas | Contenido |
|---|---|---|---|
| 4.1 | Desbroce (piloto) | 5 → 3 | [Superficie] → [Dificultad + herbicida + retirada] → [Revisar]. Calculadora largo × ancho (D3). |
| 4.2 | Setos | 6 → 3 | [Longitud + altura, con tramo en vivo] → [Caras + estado + retirada] → [Revisar]. Ayuda por pasos × 0,8 m (D3). |
| 4.3 | Árboles | 6 → 3 | [Árbol n: tamaño + tipo + acceso] → [Lista de árboles + retirada] → [Revisar]. Referencias de escala coherentes. |
| 4.3-D1 | Árboles: cantidad | — | Ver abajo. **Único cambio de datos de la ronda.** |
| 4.4 | Palmeras | 8 → 5 | [Especie con nombre común (D7)] → [Altura + estado + cantidad] → [Extras, sin «Acceso difícil» en el tramo bajo (D6)] → [Lista + retirada] → [Revisar]. |
| 4.5 | Fitosanitarios | 9 → 5 | [Qué tratar] → [Cantidad con unidad + tamaño/altura] → [Tratamiento: intención + objetivo + producto + endoterapia] → [Lista] → [Revisar]. |
| 4.6 | Césped | 4 → 3 | [Superficie] → [Estado + retirada] → [Revisar]. Calculadora (D3). |
| 4.7 | Plantas y arbustos | 5 → 3 | [Superficie] → [Tamaño + estado + retirada] → [Revisar]. Calculadora (D3). |

- **D3 (calculadoras)**: largo × ancho o pasos × 0,8 m rellenan el mismo campo; el resultado
  se redondea **hacia arriba al entero** y queda editable. Sin chips de valores rápidos.
- **D4 (retirada)**: el mismo interruptor, con el mismo valor por defecto (`true`), pasa a la
  pantalla de características; editable también en el resumen.
- **D6**: la regla visual importa `isLowestRangeThresholdForSpecies` (no se copia).
- **Riesgo**: copy que altere el significado de un valor. Cada texto se contrasta con la
  definición del prompt IA del servicio (`docs/analisis-ia-*.md`).
- **Aceptación por servicio**: número de pantallas objetivo; paridad en verde; sin desbordes.
- **Prueba local**: Niveles A–D en cada paso.

### 4.3-D1 — Número de árboles idénticos en el formulario manual

- **Qué cambia**: nuevo campo `quantity` (entero, 1–20, `MANUAL_RANGES.tree.quantity`, valor
  inicial 1) en la encuesta de árboles; `buildTreeGroups` lo pasa a cada grupo. Es el mismo
  dato que ya envía el flujo de fotos y que el servidor ya valida (`treeGroups[].quantity`).
- **Archivos**: `manualEntrySchema.ts` (un campo), `manualEntryBuilders.ts` (una línea),
  sus tests, `manualEntryPresentation.ts`.
- **Efecto esperado en precio**: con cantidad 1, idéntico al actual (el motor ya trata la
  ausencia como 1: `bookingQuoteCore.ts`, `Math.max(1, … || 1)`). El snapshot del `patch`
  gana el campo `quantity: 1`; el presupuesto no cambia. Con cantidad N, el presupuesto es
  el mismo que el del flujo de fotos para N árboles iguales (test de paridad fotos ↔ manual).
- **Despliegue**: como el esquema lo importan `booking-authority` y
  `booking-manual-declaration`, hay que **redesplegar esas dos Edge Functions** para
  mantenerlas sincronizadas. No es bloqueante (el servidor ya valida `quantity`), pero se
  hace en el mismo despliegue. Lo haces tú o se deja preparado el comando.
- **Prueba local**: Niveles A–D; además, prueba de paridad fotos ↔ manual con 1, 3 y 20
  árboles, y rechazo de 21.

## Fase 5 — Repetibles, resumen, edición y nota

- **Objetivo**: control completo de los elementos y editar sin rehacer el recorrido.
- **Archivos**: `RepeatableItemList`, `ReviewList` (sustituye a `ManualEntrySummary`),
  `ManualEntryWizard.tsx`, `DetailsPage.tsx` (`initialPhase` al volver; nota).
- **Cambios**: lista de elementos con Editar · Duplicar · Eliminar; «Cambiar» abre la
  pantalla del dato y vuelve al resumen; con el borrador completo se arranca en el resumen
  (D5); «Nota para el jardinero» opcional en el resumen, escribiendo en el mismo
  `description` que el modo fotos (D2); casilla de veracidad de 24 px con el mismo texto.
- **Riesgo**: `syncManualDraftExtras` sincroniza por índice; al eliminar se reindexa. Duplicar
  copia respuestas, no ids. La repetición de reserva (`startsOnRebookSummary`) debe seguir
  igual.
- **Aceptación**: editar un dato = 2 toques + el cambio; paridad con 1, 2 y 5 elementos;
  la nota llega igual que desde el modo fotos.
- **Prueba local**: Niveles A–D, más repetición de reserva y vuelta desde profesionales.

## Fase 6 — Accesibilidad, contraste y documentación del sistema

- **Cambios**: contraste ≥ 4,5:1 en todo el texto; radios nativos (flechas); `aria-invalid` y
  `aria-describedby`; anuncio de cambio de pantalla; `prefers-reduced-motion`;
  `docs/design-system.md` ampliado con los patrones de formulario.
- **Aceptación**: axe sin violaciones serias; recorrido completo solo con teclado; VoiceOver
  (iOS) y TalkBack (Android) en los 7 servicios.
- **Prueba local**: Niveles A–D.

## Fase 7 — QA final y despliegue

- Batería completa del banco visual en los 6 anchos y los 7 servicios.
- Flujos: multiservicio, fotos ↔ manual conservando borrador, vuelta desde profesionales,
  repetición de reserva, corrección del jardinero, envío sin sesión y con sesión.
- Paridad de precio y de telemetría.
- Prueba real en iOS Safari y Android Chrome.
- Despliegue escalonado: primero Desbroce (siempre visible), después el resto según D8.

---

## Criterios de aceptación globales

1. Snapshots de precio idénticos (salvo el cambio documentado de D1) y payload de
   `onSubmit` idéntico para las mismas respuestas.
2. `scrollWidth ≤ viewport` en todas las pantallas de 320 a 1280 px.
3. Controles ≥ 44 × 44 px (48 px los principales) y ≥ 8 px entre objetivos.
4. `inputmode` correcto, coma aceptada, Intro avanza, inputs ≥ 16 px.
5. CTA visible sin scroll a 375×667.
6. Nombre del servicio y un único «n de N» estable en cada pantalla.
7. Errores junto al campo, con rango y unidad; «Siguiente» nunca deshabilitado salvo durante
   el envío.
8. Imposible enviar un elemento incompleto; se puede eliminar y duplicar.
9. Todo texto con contraste ≥ 4,5:1.
10. Número de pantallas por servicio igual o menor al objetivo.
11. Multiservicio, fotos ↔ manual, vuelta desde profesionales, repetición y corrección del
    jardinero funcionan; telemetría con los mismos eventos e ids.
12. Texto, versión y hash del consentimiento sin cambios.
