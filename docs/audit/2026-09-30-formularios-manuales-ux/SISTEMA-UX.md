# Sistema UX/UI de los formularios manuales

Objetivo: **un mismo sistema, instancias distintas por servicio**. Se apoya en lo que ya
existe (`docs/design-system.md`, Tailwind 3, Lucide, paleta emerald/gray de la reserva) y
no introduce librerías nuevas. Prioridades: claridad > estética · móvil > escritorio ·
prevención > corrección · reutilizar > duplicar.

---

## 6. Sistema propuesto

### 6.1 Estructura de una pantalla de pregunta (móvil, 375 px)

```
┌───────────────────────────────────────────┐
│ ←        Detalles                 Salir   │  cabecera de la página (no cambia)
│ Paso 3 de 5  ▓▓▓▓▓▓▓▓▓░░░░░               │  progreso de la RESERVA (único con barra)
├───────────────────────────────────────────┤
│ ✎ Datos a mano · Usar fotos               │  selector plegado (1 línea, 44 px)
│                                           │
│ PODA DE SETOS · Pregunta 1 de 4           │  cabecera del asistente (14 px, emerald-800)
│ ¿Cuánto mide el seto?                     │  título-pregunta (20/28, semibold)
│ Aproximado vale: el profesional lo        │  apoyo, 1-2 líneas (15/22, gray-600)
│ comprueba al llegar.                      │
│                                           │
│ Longitud                                  │  etiqueta visible (15, medium)
│ ┌───────────────────────────────┐         │
│ │ 14                         m │         │  campo 56 px, número 24 px, unidad dentro
│ └───────────────────────────────┘         │
│ ▸ ¿Cómo lo mido?                          │  ayuda plegable (progressive disclosure)
│                                           │
│ Altura                                    │
│ ( – )      [ 2,0 m ]       ( + )          │  stepper 48 px, caja visible
│ Tramo de tarifa: hasta 2 m                │  feedback en vivo (14, gray-600)
│                                           │
├───────────────────────────────────────────┤  pie FIJO, fondo blanco, borde superior
│ ‹ Atrás        [      Siguiente  →      ] │  48 px; primario 2/3, secundario 1/3
└───────────────────────────────────────────┘  + safe-area-inset-bottom
```

Reglas:
- Una sola barra de progreso en pantalla: la de la reserva. Dentro del asistente, solo
  texto («Pregunta X de Y»).
- El nombre del servicio siempre visible como «eyebrow» (resuelve T-02).
- Selector de modo completo solo **antes** de elegir. En modo manual se pliega a una línea
  «Datos a mano · Usar fotos» (resuelve T-03 y el objetivo táctil de «Cambiar a fotos»).
- Nada de tarjeta alrededor del asistente: el asistente es la página (resuelve T-22).
  Una sola superficie: fondo `gray-50` de la página y controles blancos encima.

### 6.2 Jerarquía tipográfica

| Nivel | Uso | Clases |
|---|---|---|
| Eyebrow | Servicio · Pregunta X de Y | `text-sm font-semibold text-emerald-800` |
| Título | La pregunta (h2 semántico, recibe el foco) | `text-xl leading-7 font-semibold text-gray-900` |
| Apoyo | Una o dos líneas bajo el título | `text-[15px] leading-6 text-gray-600` |
| Etiqueta de campo | Siempre visible | `text-[15px] font-medium text-gray-900` |
| Texto de opción | Etiqueta de la opción | `text-base font-semibold text-gray-900` |
| Ayuda de opción | Una línea (dos como máximo) | `text-sm leading-5 text-gray-600` |
| Nota / feedback | Tramo, unidad, referencias | `text-sm text-gray-600` |

`gray-400` desaparece para texto (no llega a 4,5:1 sobre blanco). Ningún `input` con fuente
menor de 16 px (regla de `docs/design-system.md` §8).

### 6.3 Espaciado (rejilla de 4 px)

- Lateral: `px-4` (16 px), igual que la página.
- Eyebrow → título: 4 px. Título → apoyo: 4 px. Apoyo → primer control: 24 px.
- Entre campos de una misma pantalla: 24 px. Entre opciones de una lista: 8 px.
- Relleno inferior del contenido = altura del pie fijo + 16 px (que nada quede debajo).

### 6.4 Campos numéricos (`NumberField`)

- `type="text"` + `inputMode="numeric"` (enteros) o `"decimal"` (altura de seto), `pattern`,
  `autoComplete="off"`, `enterKeyHint="next"`.
- Caja visible: 56 px de alto, borde `gray-300`, `rounded-xl`, número `text-2xl font-semibold`
  alineado a la izquierda, **unidad dentro a la derecha** (`m²`, `m`, `ejemplares`).
- Coma decimal aceptada y mostrada; parseo con la lógica ya probada de `UnifiedNumericInput`
  (H-38), extraída a una función compartida y con tests propios.
- Validación **al salir del campo** y al pulsar «Siguiente»; nunca mientras se teclea;
  **nunca corrección silenciosa** del valor (P-10).
- Rango visible solo cuando ayuda («Entre 1 y 5.000 m²») y con formato es-ES.

### 6.5 Stepper (`Stepper`)

- Solo para cantidades pequeñas con defecto claro (número de palmeras 1–50) y para la
  altura del seto (hay tramos).
- Botones de 48 × 48 px, caja central visible y editable.
- **Ajuste a la rejilla**: ± lleva al siguiente múltiplo del paso (0,3 → 0,5 → 1,0 → 1,5 →
  2,0), respetando el mínimo y el máximo del schema.
- Línea de feedback opcional debajo (tramo de tarifa de setos).

### 6.6 Selección única

Dos variantes, decididas por el contenido y no por el servicio:

**`OptionList`** (por defecto): una columna, filas de ancho completo.
```
┌───────────────────────────────────────┐
│ [icono]  Descuidado                ◯ │  min-h 56 px; icono 24 px gris
│          Crecimiento desigual, bordes │  ayuda ≤ 2 líneas
│          invadidos                    │
└───────────────────────────────────────┘
```
- Seleccionada: borde `emerald-600` de 2 px **con `ring` interior** (sin cambiar medidas),
  fondo `emerald-50`, radio relleno. **No aparece ningún icono nuevo al seleccionar**: el
  hueco del radio es fijo (resuelve T-06).
- `role="radiogroup"` con `aria-labelledby` al título; cada fila `role="radio"` con
  `aria-describedby` a su ayuda.
- Sin `hover:` en táctil (`@media (hover:hover)` o la variante `hover:` solo desde `sm:`).

**`SegmentedChoice`**: para 2-4 opciones con etiqueta corta (≤ 12 caracteres) y **sin
ayuda por opción** (alturas de palmera, «1 cara / 2 caras» si se decide sin ayuda,
«Convencional / Ecológico» con una ayuda común debajo). Patrón ya existente en
`AvailabilityManager.tsx:366-403` (`bg-gray-100 rounded-xl p-1`, activa `bg-white shadow-sm`),
con 48 px de alto. **Ajuste F6:** la activa lleva además `ring-1 ring-emerald-600` y texto
`emerald-800`: blanco sobre gris no se distinguía bien a 375 px para una respuesta que cambia el
precio (acceso de árboles).

Se descarta la rejilla de 2 columnas de tarjetas por debajo de `md:` (regla de
`docs/design-system.md` §9).

### 6.7 Opciones sí/no y extras (`ToggleRow` / `ChoiceRow`)

- **Extra opcional** (herbicida, pelado de tronco, endoterapia, acceso difícil): fila
  entera pulsable (`<label>` que envuelve el switch o botón `role="switch"` a ancho
  completo), min-h 56 px, etiqueta + una línea de ayuda. Si tiene coste, lo dice.
- **Decisión con efecto en precio** (retirada de restos): dos opciones explícitas en
  `OptionList` («Sí, que se lleven los restos» / «No, me encargo yo»). Mismo booleano, mismo
  defecto: se ve lo que se elige.
- **Extra recomendado activado** (fitosanitario de palmera): etiqueta «Recomendado» y
  primera posición. Se mantiene activado (P-13).
- **F7:** el coste se dice **una vez**, en la frase de apoyo de la pantalla («Cada opción puede
  tener un coste adicional según el profesional.»), no en cada fila. La insignia es `badge` en la
  presentación (`ToggleRow`), y se lee como descripción del interruptor.
- **Ocultar lo inerte** (`hiddenWhen`): solo si el constructor ya descarta la respuesta (P-04,
  acceso de palmeras en el tramo más bajo). Si una pantalla se queda sin preguntas, desaparece.

- **F9 (desbroce):** «Opciones del servicio» reúne el herbicida (interruptor) y la retirada (dos
  opciones, con su nombre encima) en la última pantalla (`wasteOnScreen`); el coste se dice una vez
  arriba y no se repite en «Sí, que se lleven los restos». Solo en servicios no repetibles.

**Fotos por opción** (`optionImages`, F7): 56 × 56 px a la izquierda de la fila, decorativas
(`alt=""`). Sin foto no se pinta hueco vacío. Las de palmeras se registran en
`presentation/palmSpeciesPhotos.ts` (D-13: las aporta el usuario más adelante).

### 6.8 Ayudas y contexto (`HelpDisclosure`, `ReferenceNote`)

- Una sola frase de apoyo bajo el título. Lo que la repite, se quita (T-18).
- Referencias de medida («una plaza de garaje ≈ 12 m²», «1 paso ≈ 0,8 m») en un
  desplegable «¿Cómo lo mido?», cerrado por defecto, con el mismo formato en los 7.
- El aviso «Verás el precio con cada profesional en el siguiente paso» aparece **una vez**,
  en el resumen, junto al botón final.

### 6.9 Progreso y navegación

- «Pregunta X de Y»: Y = pantallas de preguntas visibles **+ retirada** (si aplica). El
  resumen no cuenta como pregunta, se llama «Revisión».
- Si el flujo es condicional (fitosanitarios), Y se calcula suponiendo visibles las
  preguntas cuya condición aún no está decidida, así **solo puede bajar** y nunca crecer.
- Pie fijo con «Atrás» (secundario, 1/3) y la acción principal (2/3). En la primera
  pregunta «Atrás» no aparece en el pie (la cabecera de la página ya vuelve atrás) o, si se
  mantiene, hace algo (D-08).
- Foco: al cambiar de pantalla, al título (ya existe). Al fallar, al primer campo con error.
- Al recargar: se vuelve a la última pantalla alcanzada (guardar `phase`/índices en el
  borrador de presentación, no en el payload). Prioridad baja.

### 6.10 Errores (`FieldError`)

- Debajo del control, antes de la ayuda: icono `AlertCircle` 16 px + texto `text-sm
  text-red-700`, `id` enlazado con `aria-describedby`, y en el campo `aria-invalid` y borde
  rojo.
- «Siguiente» **no se deshabilita**: al pulsarlo con errores, foco al primero y
  `scrollIntoView` con margen para el pie fijo.
- Mensajes específicos y con artículo: «Indica la superficie de césped», «La superficie no
  puede pasar de 5.000 m²».

### 6.11 Estados

| Estado | Tratamiento |
|---|---|
| Normal | Borde `gray-300` (campos) / `gray-200` (filas), fondo blanco |
| Foco | `ring-2 ring-emerald-600 ring-offset-2` (visible también en táctil tras teclado) |
| Seleccionado | Borde 2 px `emerald-600` sin cambio de medidas, fondo `emerald-50`, radio relleno |
| Error | Borde `red-600`, texto `red-700`, `aria-invalid` |
| Deshabilitado | `opacity-50 cursor-not-allowed` y texto que explica por qué (solo el botón final sin casilla) |
| Cargando | Botón final «Guardando…» con spinner 16 px y `aria-busy`; el pie no se mueve |

### 6.12 Repetibles (`ItemList`)

Pantalla intermedia rediseñada:
```
Árboles añadidos
┌───────────────────────────────────────┐
│ Árbol 1                               │
│ Mediano (3–5 m) · Estructural · Normal│
│ [Editar]                   [Eliminar] │
└───────────────────────────────────────┘
+ Añadir otro árbol          (secundario)
[ Continuar ]                (pie fijo)
```
- Plurales correctos por servicio (`itemNounPlural` en la capa de presentación).
- «Atrás» desde la primera pregunta de un elemento recién añadido y vacío → lo descarta.
- Eliminar pide confirmación con `ConfirmDialog` (componente canónico).
- Un elemento incompleto nunca llega al resumen como válido (P-01).
- **F6:** los servicios que lo declaran (`allowDuplicate`, hoy solo árboles, D-04) ofrecen
  «Duplicar» entre «Editar» y «Eliminar» en los elementos completos; la copia se añade al
  final y se anuncia («Añadido el árbol 3, igual que el árbol 1.», `role="status"`).
- Cabecera del elemento en las preguntas: «Árbol 2 · Pregunta 1 de 3».

### 6.13 Revisión (`ReviewList`) y consentimiento

- Una sección por elemento (título «Árbol 1», «Tu seto», «Tu césped»), sin tarjeta dentro
  de tarjeta: lista `dl` con separadores.
- Cada fila: etiqueta · valor formateado (es-ES, unidad) · «Cambiar» (44 px de objetivo)
  que lleva **a esa pregunta** y vuelve a la revisión.
- Booleanos: lo elegido («Acceso normal»), no «Sí/No».
- Casilla de veracidad: fila de 48 px, casilla de 20 px, texto corto de `strings.ts` y el
  texto legal íntegro plegado (sin cambiar ni un carácter de `legalCopy.ts`).
- Pie fijo: «Confirmar y continuar». Si falta la casilla, el aviso va **encima del botón**,
  no debajo de «Atrás».

### 6.14 CTA principal

| Pantalla | Texto |
|---|---|
| Pregunta | «Siguiente» |
| Pantalla intermedia de repetibles | «Continuar» |
| Última pregunta antes de revisión | «Revisar mis datos» |
| Revisión | «Confirmar y continuar» (sin cambios) |
| Corrección del jardinero | «Recalcular precio» (sin cambios) |

---

## 7. Componentes reutilizables propuestos y arquitectura

### 7.1 Capa de presentación solo de cliente (decisión de arquitectura)

`manualEntrySchema.ts` y `manualEntryValidation.ts` se quedan **intactos** (P-07). Se crea
una capa de presentación que el schema no conoce:

```
src/components/booking/manual/
  presentation/
    manualEntryPresentation.ts   // por servicio: agrupación de pantallas (qué stepIds van juntos),
                                 //   control por campo (number | stepper | list | segmented | toggle | choice),
                                 //   unidades dinámicas (fitosanitarios), títulos por contexto,
                                 //   plurales, referencias «¿Cómo lo mido?», etiquetas de revisión,
                                 //   ocultaciones de presentación (P-04), etiqueta principal/secundaria
                                 //   de opciones (especies), iconos coherentes
    formatManualValue.ts         // formato es-ES de números, unidades y booleanos para la revisión
    screens.ts                   // (puro) calcula las pantallas visibles y «Pregunta X de Y»
  ui/
    ManualStepHeader.tsx         // eyebrow + título (h2 con foco) + apoyo
    WizardFooter.tsx             // pie fijo con safe-area, Atrás + principal, estado cargando
    NumberField.tsx              // campo numérico con unidad y coma (parseo compartido)
    Stepper.tsx                  // ± con rejilla + caja editable + feedback
    OptionList.tsx               // selección única de 1 columna
    SegmentedChoice.tsx          // 2-4 opciones cortas
    ToggleRow.tsx                // fila entera con switch
    FieldError.tsx               // error accesible bajo el campo
    HelpDisclosure.tsx           // «¿Cómo lo mido?»
    ItemList.tsx                 // lista de elementos repetibles con editar/eliminar
    ReviewList.tsx               // revisión con «Cambiar» por fila
    ConsentRow.tsx               // casilla de veracidad + texto legal plegado
  ManualEntryWizard.tsx          // orquesta: mismo contrato de props y de payload
  ManualEntryChoice.tsx          // + variante plegada
  ManualEntrySummary.tsx         // pasa a usar ReviewList + ConsentRow
  fields/ManualFieldRenderer.tsx // pasa a delegar en ui/* según la capa de presentación
```

- Se reutiliza: el registro de iconos (`MANUAL_ICON_NAMES` + su test), `ConfirmDialog`,
  el patrón de segmentado de `AvailabilityManager`, la lógica de parseo de
  `UnifiedNumericInput` (extraída a `src/shared/numberParsing.ts` o similar, con los dos
  consumidores apuntando a ella).
- **No se crea** un sistema genérico de formularios para toda la app: los componentes viven
  en `booking/manual/ui` y solo se promueven a `common/` si otro flujo los necesita.
- **No cambia** la interfaz pública de `ManualEntryWizard` (props y `onSubmit`), que usan
  `DetailsPage` y `BookingRequestsManager`. Solo se añaden props opcionales si hacen falta.

### 7.2 Correspondencia con los nombres sugeridos

| Sugerido | Propuesto | Motivo |
|---|---|---|
| FormSection | `ManualStepHeader` + la propia pantalla | En un asistente paso a paso la «sección» es la pantalla |
| FieldGroup | Agrupación declarada en `manualEntryPresentation.ts` | La agrupación es por servicio: se declara, no se maqueta a mano |
| FormField | `NumberField` / `Stepper` / `OptionList` con etiqueta propia | Cada control trae su etiqueta, su error y su ayuda |
| OptionCard | `OptionList` (fila) | Tarjeta de 2 columnas descartada por la medida (§2 de la auditoría) |
| SegmentedControl | `SegmentedChoice` | Reutiliza el patrón de `AvailabilityManager` |
| QuantityInput | `NumberField` (+ `Stepper` para cantidades pequeñas) | Dos casos de uso distintos (NN/g) |
| ContextualHelp | `HelpDisclosure` | Plegado por defecto |
| FieldError | `FieldError` | — |
