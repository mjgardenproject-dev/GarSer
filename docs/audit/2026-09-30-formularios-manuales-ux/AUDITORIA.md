# Auditoría UX/UI de los formularios manuales de «Detalles»

Fecha: 2026-09-30 · Base auditada: `origin/main` @ 81397be (idéntico a la rama
`feat/formularios-manuales-ux-v2` salvo documentación) · Método: lectura del código +
recorrido real de los 7 formularios en `localhost:5173` contra el Supabase local, a
**375 × 812** (móvil), 768 × 1024 (tablet) y 1280 × 800 (escritorio), con medidas del DOM
tomadas en cada pantalla.

Convenciones: **T-xx** = problema transversal (vive en el shell compartido y afecta a
varios servicios). **P-xx** = punto con posible efecto en precio (§10). Las medidas en px
son CSS px a 375 px de ancho; «y» es la posición vertical en la página, con el pliegue
en 812.

---

## 1. Auditoría del código relevante

### 1.1 Mapa de piezas

| Capa | Archivo | Qué hace | ¿Presentación o lógica? |
|---|---|---|---|
| Definición de encuestas | `src/shared/manualEntry/manualEntrySchema.ts` | Por servicio: pasos → campos (`key`, `type`, `ui`, `label`, `help`, `example`, `unit`, `min/max/step`, `options`, `dynamicOptions`, `visibleWhen`, `defaultValue`). También `MANUAL_RANGES`, bandas de palmeras, reglas por especie y `MANUAL_GLOBAL_WASTE_*` | **Mixta.** `key`, valores de opciones, rangos, defaults y `visibleWhen` son contrato. `label`/`help`/`example`/`icon`/`title`/`description` son presentación, pero **el archivo lo empaquetan dos Edge Functions** (`booking-authority`, `booking-manual-declaration`) |
| Validación | `src/shared/manualEntry/manualEntryValidation.ts` | `validateManualField` (UX, por campo) y `validateManualBookingInput` (servidor, sobre el payload construido) | Lógica. Compartida con Deno |
| Constructores | `src/pages/reserva/manualEntryBuilders.ts` | Respuestas → colecciones del motor (`lawnZones`, `hedgeZones`, `treeGroups`, `palmGroups`, `shrubGroups`, `phytosanitaryZones`, `weedingZones`) + `declaredVariables` | Lógica de precio. **No se toca** |
| Motor | `src/shared/bookingQuoteCore.ts` | Precio y horas | Lógica. **No se toca** |
| Carcasa del asistente | `src/components/booking/manual/ManualEntryWizard.tsx` | Fases `item → interstitial → waste → summary`, progreso, navegación, foco, borrador | Presentación + estado de navegación |
| Controles | `src/components/booking/manual/fields/ManualFieldRenderer.tsx` | `stepper`, `slider`, `toggle`, `cards` + registro de iconos Lucide | Presentación |
| Resumen y consentimiento | `src/components/booking/manual/ManualEntrySummary.tsx` | Tabla de lo declarado + casilla de veracidad (texto legal en `legalCopy.ts`) | Presentación (el texto legal no se toca) |
| Selector fotos / manual | `src/components/booking/manual/ManualEntryChoice.tsx` | Dos tarjetas «Con fotos» / «Escribo los datos» | Presentación |
| Textos del shell | `src/shared/manualEntry/strings.ts` | Microcopy de botones, resumen, consentimiento | Presentación |
| Integración | `src/pages/reserva/DetailsPage.tsx` (≈ l. 797-830, 985-1010, 1726-1830, 4686-4720, 6734) | Activa el modo, monta el asistente, guarda `manualDraft`, construye y valida el patch al enviar, telemetría, CTA fijo oculto en modo manual | Mixta: el envío es lógica; el montaje, presentación |
| Segundo consumidor | `src/components/gardener/BookingRequestsManager.tsx:770-800` | **El jardinero reutiliza el mismo asistente** (`requireConsent={false}`, «Recalcular precio») para corregir en la visita | Todo cambio del shell le afecta |
| Bandera | `src/utils/manualEntryFeatureFlag.ts` | `VITE_ENABLE_MANUAL_BOOKING_INPUT` (en `.env.production` = `true`: **el flujo está en producción**) | — |

### 1.2 Cómo funciona hoy (flujo real)

1. En «Detalles» (paso 3 de 5 de la reserva) se muestra el selector «¿Cómo calculamos tu
   presupuesto?» (salvo desbroce, que es solo manual y va directo al asistente).
2. Al elegir «Escribo los datos», se oculta todo el bloque de fotos (incluido el **título
   del servicio**) y el CTA fijo de la página, y aparece el asistente dentro de una tarjeta.
3. Fase `item`: una pantalla por paso del schema con sus campos visibles. «Siguiente»
   valida con `validateManualField`. El primer fallo activa `showErrors` y **deshabilita
   «Siguiente»** hasta que se corrija.
4. Servicios repetibles (árboles, palmeras, fitosanitarios): fase `interstitial` «¿Quieres
   añadir más?».
5. Fase `waste` (retirada de restos, excepto fitosanitarios) → fase `summary` (resumen +
   casilla de veracidad) → «Confirmar y continuar».
6. Al confirmar, `DetailsPage.handleManualSubmit`: `buildManualBookingPatch` →
   `validateManualBookingInput` → (si hay sesión) `recordManualDeclaration` →
   `commitDetailsPatch` → siguiente servicio o «Profesionales».
7. Cada cambio de respuesta escribe el borrador en `servicesData[id].manualDraft` (sobrevive
   a recargar; **la posición en el asistente no**, se vuelve a la pregunta 1).

### 1.3 Qué es lógica de precio y qué es solo presentación

| Nunca tocar (contrato) | Se puede tocar (presentación) |
|---|---|
| `key` de cada campo y `value` de cada opción | Orden visual, agrupación de pantallas, jerarquía |
| `MANUAL_RANGES`, `min`/`max`, `defaultValue`, `visibleWhen` como regla de negocio | Tipo de control (slider → campo numérico, tarjetas → lista…) si el valor enviado es el mismo |
| `dynamicOptions` (bandas de palmera por especie, portes de fitosanitarios) | Etiquetas, ayudas, ejemplos, iconos, unidades mostradas, formato de números |
| Constructores, validación, motor, Edge Functions, Supabase | Navegación, foco, errores visuales, estados, espaciado, tamaños |
| Forma de `ManualWizardSubmitPayload` (`items[]`, `wasteRemoval`) | Pantalla intermedia de repetibles, resumen, consentimiento (sin cambiar el texto legal) |
| Texto legal (`legalCopy.ts`) y `MANUAL_ENTRY_LEGAL_VERSION` | Microcopy del shell (`strings.ts`) |
| Nombres de evento y `stepId` de la telemetría (`booking.manual_entry_step_completed`) | — (se puede reagrupar pantallas si se siguen emitiendo los mismos `stepId`) |

Consecuencia de arquitectura: como `manualEntrySchema.ts` lo empaquetan dos Edge Functions,
**la presentación nueva debe vivir en una capa solo de cliente** y dejar el schema intacto
(ver `SISTEMA-UX.md` §7.1). Así ningún cambio de esta ronda obliga a redesplegar funciones.

### 1.4 Controles por servicio (inventario)

| Servicio | Pasos del schema (ids) | Controles | Repetible | Retirada |
|---|---|---|---|---|
| Césped | `surface`, `state` | slider 1–5000 m² · tarjetas ×3 | no | sí |
| Setos | `length`, `height`, `faces`, `state` | slider 1–200 m · stepper 0,3–6 m paso 0,5 · tarjetas ×2 · tarjetas ×3 | no | sí |
| Árboles | `size`, `pruning_type`, `access` | tarjetas ×4 · ×2 · booleano como tarjetas ×2 | sí | sí |
| Palmeras | `species`, `height`, `state`, `quantity`, `extras` | tarjetas ×6 · tarjetas dinámicas ×2-4 · ×3 · stepper 1–50 · 3 interruptores (condicionados por especie) | sí | sí |
| Arbustos | `surface`, `size`, `state` | slider 1–2000 m² · tarjetas ×3 · ×3 | no | sí |
| Fitosanitarios | `affected`, `area`, `size`*, `intent`, `target`*, `product`, `height`*, `endotherapy`* | tarjetas ×5 · **stepper 1–5000 sin unidad** · dinámicas ×3 · ×2 · ×3 · ×2 · interruptor · interruptor (*condicional) | sí | **no** (correcto) |
| Desbroce | `area`, `state`, `herbicide` | slider 1–10000 m² · tarjetas ×3 · interruptor | no | sí |

---

## 2. Auditoría visual / UX (interfaz real)

Recorrido completo de los 7 formularios en local (captura de medidas por pantalla). Lo que
se ve en **todos** antes de entrar en cada servicio:

**Primer pliegue (375 × 812) al entrar en modo manual.** De arriba abajo: cabecera
«Detalles» + «Salir» (68 px), barra «Paso 3 de 5» (≈ 50 px), selector de 2 tarjetas de
122 px con título y nota (≈ 300 px) y, en y ≈ 375, la tarjeta del asistente con **su
propia** barra y «Paso 1 de 2». La pregunta empieza en y ≈ 440 y el control en y ≈ 555:
**el 55 % del primer pliegue lo ocupa lo que no es la pregunta.** Con un solo servicio,
**el nombre del servicio no aparece en ningún sitio** mientras se responden las preguntas
(el título vive en el bloque de fotos, que está oculto). Solo sale, en gris y 12 px, en las
pantallas de retirada y resumen.

**CTA fuera del pliegue.** «Siguiente» queda por debajo de 812 px en la primera pantalla
de césped (y = 826), en el tamaño de árbol (y = 1028), en la especie de palmera
(y = 1164), en los extras de palmera (y = 1170), en el tamaño de arbustos (y = 1003) y en
el tipo de vegetación de fitosanitarios (y = 998). El modo fotos de la misma página tiene
CTA fijo abajo. En el modo manual el botón está al final del contenido.

**Doble progreso que se contradice.** «Paso 3 de 5» (reserva) + «Paso 1 de 2» (asistente)
con dos barras. Además el contador del asistente miente: en césped dice «Paso 2 de 2» y
luego vienen retirada y resumen. En fitosanitarios el total **crece** mientras se avanza
(«Paso 1 de 4» → «Paso 2 de 5» → «Paso 5 de 6»).

**Tarjetas de opciones en 2 columnas fijas.** A 375 px cada tarjeta mide 145-147 px de
ancho y la columna de texto ≈ 80 px: las ayudas quedan a 1-2 palabras por línea y las
tarjetas miden entre 106 y 266 px de alto. Hay palabras que **desbordan la tarjeta**
(«mantenimiento», «Aproximadamente», «Washingtonia», «romanzoffiana», «fortunei»). Con 3 o
5 opciones queda una tarjeta huérfana. Contradice `docs/design-system.md` §9 («nunca dos
columnas por debajo de `md:`»).

**Salto al seleccionar.** Al marcar una tarjeta aparece un icono de check a la derecha que
estrecha el texto: la tarjeta cambia de altura y el contenido se recoloca (observado en
«Las dos caras», que pasa de 3 a 5 líneas).

**Escritorio y tablet.** La página limita el contenido a 416 px (`sm:max-w-md`) en 768 y en
1280 px: el diseño es el mismo que en móvil, con «Atrás» y la acción principal en fila.
No hay problemas propios de escritorio; lo que falla en móvil falla igual allí (aunque se
note menos). La prioridad absoluta es móvil.

---

## 3. Análisis individual de cada formulario

### 3.1 Corte de césped

**Recorrido:** superficie (slider) → estado (3 tarjetas) → retirada → resumen. 4 pantallas, el
contador dice «de 2».

**Problemas de UX**
- El slider 1–5000 m² no sirve para los valores reales: 80 m² es el 1,6 % del recorrido;
  el pulgar se queda pegado al extremo izquierdo y moverlo con el dedo salta decenas de m².
- Con el campo vacío, el slider muestra el pulgar en 1 m²: dos controles dicen cosas distintas.
- «Paso 2 de 2» en el estado, y después aparecen dos pantallas más.
- No se sabe qué servicio se está rellenando (no aparece «Corte de césped» en las preguntas).

**Problemas de UI**
- El campo numérico es una línea verde sin caja: no parece un campo hasta que tiene número.
- Tarjetas de estado de 219/219/266 px; «mantenimiento» se sale de la tarjeta; huérfana «Muy descuidado».
- Etiquetas del slider «1 m²» / «5000 m²» sin separador de miles.

**Problemas de jerarquía**
- La descripción del paso y la ayuda del campo dicen lo mismo («superficie aproximada»/«superficie total»), una arriba y otra debajo del control.
- El texto «Verás el precio con cada profesional en el siguiente paso» pesa igual que la ayuda y se repite en cada pantalla.

**Problemas de orden**
- Ninguno de fondo: cantidad → estado → retirada es el orden correcto.

**Problemas específicos de móvil**
- «Siguiente» en y = 826 (fuera del pliegue) en la primera pantalla.
- Pulgar del slider por debajo de 44 px y pista de 8 px.

**Problemas de comprensión**
- «Normal / Descuidado / Muy descuidado» se entiende, pero las ayudas largas en columnas de 80 px no se leen de un vistazo.

**Campos con demasiada carga cognitiva**
- Superficie: el cliente no sabe cuántos m² tiene. La ayuda (plaza de garaje 12 m², pádel 200 m²) es buena, pero está al final, en gris claro, debajo del slider.

**Campos que deberían agruparse**
- Ninguno. Son dos preguntas de naturaleza distinta.

**Campos que deberían separarse visualmente**
- Las referencias de medida («¿Cómo lo mido?») del texto de ayuda.

**Interacciones mejorables**
- Sustituir slider por campo numérico con unidad dentro y teclado numérico.
- Pantalla de retirada como elección explícita.

**Feedback y validación**
- Vacío → «Indica superficie de césped.» (sin artículo), pegado al final del bloque de ayuda, sin borde rojo en el campo, sin mover el foco, y el botón se desactiva.
- Fuera de rango al teclear 99999 → mensaje correcto pero «5000» sin formato.

**Oportunidades de mejora**
- Método de medida en una línea («largo × ancho en pasos; 1 paso ≈ 0,8 m») plegado bajo el campo.
- Es el formulario más usado y el más simple: ideal para validar el sistema nuevo.

**Qué mantendría exactamente igual:** las dos preguntas, sus claves y valores, el rango 1–5000, los tres estados y sus ayudas (texto), la referencia de la plaza de garaje y la pista de pádel.
**Qué reorganizaría:** la ayuda y la referencia de medida, justo bajo el campo; el aviso de precio, una sola vez.
**Qué rediseñaría:** el control de superficie (campo numérico grande con unidad, sin slider) y las tarjetas de estado (lista de 1 columna).
**Qué simplificaría visualmente:** quitar la descripción duplicada, la tarjeta dentro de la tarjeta y la segunda barra de progreso.
**Qué comportamiento cambiaría:** validación al salir del campo, error junto al campo con foco, «Siguiente» siempre activo y fijo abajo.
**Qué NO debe tocarse:** `superficie_m2`, `estado_jardin` y sus literales (`'muy descuidado'` con espacio), `MANUAL_RANGES.lawn`, el builder.

### 3.2 Poda de setos

**Recorrido:** longitud (slider) → altura (stepper) → caras (2 tarjetas) → estado (3) → retirada → resumen. 6 pantallas.

**Problemas de UX**
- **El stepper de altura no pasa por 2,0 m** (P-03): arranca en 0,3 (el mínimo) y suma 0,5 → 0,8 · 1,3 · 1,8 · 2,3 m. El límite entre el tramo «hasta 2 m» y «2–4 m» es justo 2,0 m, y el ejemplo de la propia pantalla dice «una puerta mide unos 2 m». Quien use los botones para un seto de 2 m acaba en 1,8 o en 2,3: **o se queda en el tramo bajo o salta al alto**, que es otra tarifa.
- El cliente no ve en qué tramo de tarifa cae la altura que declara, aunque la ayuda le avisa de que «la altura decide la tarifa».
- La pantalla de caras usa un icono `Square` que **parece una casilla sin marcar**.

**Problemas de UI**
- Con el stepper vacío se ve «–  m  +» sin caja en medio: no se entiende que se puede escribir.
- Tarjetas de caras: al seleccionar «Las dos caras» el texto pasa de 3 a 5 líneas (salto).
- «mantenimiento.» se sale de la tarjeta del estado «Normal».

**Problemas de jerarquía**
- Longitud: descripción y ayuda son **la misma frase** dos veces («La longitud total a lo largo del seto… suma los tramos»).

**Problemas de orden**
- Correcto (medidas → caras → estado). Longitud y altura son dos medidas del mismo objeto y podrían ir juntas.

**Problemas específicos de móvil**
- Slider 1–200 m con pulgar pequeño: más usable que el de césped, pero impreciso.
- En la pantalla de altura, el teclado decimal de iOS en español escribe coma, y `type="number"` no la acepta de forma fiable (riesgo documentado por GOV.UK; ver §5).

**Problemas de comprensión**
- «Caras»: el término es del oficio. La ayuda lo resuelve, pero a 80 px por línea.
- Altura: «incluyendo muros o estructuras que el profesional deba alcanzar» es importante y está en la descripción larga, que se lee poco.

**Campos con demasiada carga cognitiva**
- Altura: decimal, con tarifa por tramos, sin feedback del tramo.

**Campos que deberían agruparse**
- Longitud + altura en «Medidas del seto» (una tarea, dos datos), sin dejar de emitir los `stepId` `length` y `height`.

**Campos que deberían separarse visualmente**
- La advertencia «la altura decide la tarifa» (hoy mezclada con el ejemplo de la puerta).

**Interacciones mejorables**
- Stepper que ajusta a la rejilla de 0,5 (0,5 · 1,0 · 1,5 · 2,0…) y admite escribir cualquier valor válido con coma.
- Línea de feedback bajo la altura: «Tramo de tarifa: hasta 2 m» (de `HEDGE_BAND_LABELS`, sin cambiar datos).

**Feedback y validación**
- Resumen: «Altura del seto 2.3 m» con **punto** mientras el campo mostraba «2,3».

**Oportunidades de mejora**
- Ilustración mínima de «una cara / dos caras» (planta vista desde arriba) en vez de iconos genéricos.

**Qué mantendría exactamente igual:** claves `longitud_m`, `altura_m`, `caras` (`'1'`/`'2'`), `estado_seto` (`normal`/`media`/`alta` con etiquetas Descuidado/Muy descuidado), rangos 1–200 y 0,3–6, el `step` 0,5 como paso de los botones.
**Qué reorganizaría:** longitud y altura en una misma pantalla; la advertencia de tarifa junto a la altura.
**Qué rediseñaría:** el stepper (caja visible, rejilla, coma decimal), las tarjetas de caras (lista de 2 filas con dibujo simple) y el estado (lista).
**Qué simplificaría visualmente:** la frase duplicada de la longitud.
**Qué comportamiento cambiaría:** ajuste a rejilla en ±; feedback de tramo en vivo; formato es-ES en el resumen.
**Qué NO debe tocarse:** `mapHedgeHeightToBand`, `HEDGE_HEIGHT_BANDS`, el builder (`length_pricing_m` es longitud base; el motor multiplica por caras).

### 3.3 Poda de árboles

**Recorrido:** tamaño (4 tarjetas) → tipo de poda (2) → acceso (2) → «¿Quieres añadir más?» → retirada → resumen. 3 pantallas por árbol.

**Problemas de UX**
- **Elemento fantasma que se cobra (P-01, crítico).** Reproducido: «Añadir otro árbol» → «Atrás» vuelve al árbol 1, pero el árbol 2 vacío se queda en la lista. La pantalla intermedia dice «Has añadido 2 árbols», el resumen muestra «Árbol 2» con «—» en tamaño y poda, y **deja confirmar**. El constructor rellena lo vacío con `small` + `structural`, y en `servicesData` queda un segundo `treeGroup` que el motor cobra. El cliente paga un árbol que no ha declarado.
- No hay forma de **eliminar** un árbol añadido (ni en la pantalla intermedia ni en el resumen).
- La pantalla intermedia no tiene «Atrás» ni lista qué árboles llevas.
- Al volver al árbol 1 el contador dice lo mismo («Paso 1 de 3»): no sabes qué árbol editas.
- Para 5 árboles iguales hay que responder 15 pantallas (el manual no pregunta cantidad; el flujo de fotos sí habla de «grupo de árboles iguales»).

**Problemas de UI**
- Tarjetas de tamaño de 198-222 px de alto; «Aproximadamente» desborda; «Siguiente» en y = 1028.
- Tipo de poda: 2 tarjetas de 243 px para una elección binaria. Acceso: 2 tarjetas de 221 px.

**Problemas de jerarquía**
- El rango en metros va dentro de la etiqueta («Mediano (3-5 m)») y compite con la referencia.

**Problemas de orden**
- Correcto. Acceso es la pregunta de menor peso y va al final, bien.

**Problemas específicos de móvil**
- La pantalla de tamaño necesita scroll en todos los casos.

**Problemas de comprensión**
- **Referencias de altura incoherentes:** «Pequeño (0-3 m): hasta la altura de una planta baja **o puerta**» (una puerta mide 2 m); «Mediano (3-5 m): aproximadamente **la altura de una planta** de un edificio» (una planta mide unos 3 m, que es el límite inferior del tramo). El cliente usa la referencia, no el número: una referencia equivocada lleva a otro tramo de tarifa.
- «Poda de formación» significa en arboricultura poda de árboles jóvenes, y la ayuda dice «mantenimiento estético». El panel del jardinero usa el mismo nombre («Formación: árboles jóvenes o mantenimiento ligero»), así que **el nombre no se cambia**: se aclara la ayuda.

**Campos con demasiada carga cognitiva**
- Tamaño: cuatro tramos con número + referencia + icono.

**Campos que deberían agruparse**
- Ninguno dentro del árbol. A nivel de lista: «Duplicar este árbol» (D-04).

**Campos que deberían separarse visualmente**
- Número del tramo (dato) y referencia (ayuda).

**Interacciones mejorables**
- Lista de árboles con editar/eliminar; «Atrás» desde un árbol recién añadido y vacío lo descarta.
- «Editar» desde el resumen debería llevar a la pregunta concreta, no al principio del árbol.

**Feedback y validación**
- El resumen pinta el booleano como «Dificultad de acceso: No» en lugar de lo que el cliente eligió («Acceso normal»).

**Oportunidades de mejora**
- Referencias por plantas de edificio, coherentes con los tramos (D-03).

**Qué mantendría exactamente igual:** `aiSizeBand` (`small`/`medium`/`large`/`over_9`), `pruningType` (`structural`/`shaping`), `difficultyHigh`, los nombres «Poda estructural» y «Poda de formación».
**Qué reorganizaría:** número del tramo como dato principal y referencia debajo; acceso como elección compacta.
**Qué rediseñaría:** la pantalla intermedia (lista de árboles con editar/eliminar) y las tarjetas (lista de 1 columna).
**Qué simplificaría visualmente:** las tarjetas de 220-240 px para elecciones binarias.
**Qué comportamiento cambiaría:** no permitir que un árbol incompleto llegue al resumen ni se envíe; «Atrás» descarta un árbol recién añadido vacío.
**Qué NO debe tocarse:** `buildTreeGroups` y sus defaults (el arreglo del fantasma es de interfaz, no del constructor), la ausencia de `quantity` en el manual (decisión de datos, fuera de alcance: D-04).

### 3.4 Poda de palmeras

**Recorrido:** especie (6 tarjetas) → altura del tronco (2-4 según especie) → estado (3) → número (stepper) → opciones adicionales (hasta 3 interruptores) → «¿Añadir más?» → retirada → resumen. 5 pantallas por grupo: es el formulario más largo por elemento.

**Problemas de UX**
- **Especie en latín como etiqueta principal** («Phoenix canariensis», «Syagrus romanzoffiana»). Un cliente no técnico reconoce «palmera canaria» o «datilera», que hoy están en la ayuda pequeña.
- Las 6 especies tienen el **mismo icono** (`Palmtree`): el icono no ayuda a distinguir.
- Si se vuelve atrás y se cambia la especie, la altura elegida puede dejar de existir en la nueva lista: la pantalla aparece sin nada marcado y sin explicar por qué.
- «Acceso difícil» se muestra aunque la altura sea el tramo más bajo, y ahí **el constructor lo descarta** (P-04): el cliente cree que declara algo que no cuenta.
- El tratamiento fitosanitario viene activado (decisión de negocio vigente, P-13). La ayuda es larga (223 px de tarjeta) y no dice que tiene coste.

**Problemas de UI**
- Especie: 6 tarjetas de 152-198 px en 3 filas; «Siguiente» en y = 1164 (350 px por debajo del pliegue); desbordan «Washingtonia», «romanzoffiana», «fortunei».
- Altura: «0-4 m» y «4-10 m» miden 58 px, pero «Más de 10 m» mide **266 px** porque lleva ayuda en una columna estrecha y se queda sola en la fila.
- Extras: tres bloques con borde de 108-223 px; título «Opciones adicionales» no es una pregunta.

**Problemas de jerarquía**
- En la pantalla de extras compiten tres interruptores del mismo peso, aunque uno viene activado y es «esencial».

**Problemas de orden**
- Estado antes que número: coherente con la tarifa por unidad. Correcto.

**Problemas específicos de móvil**
- La pantalla de especie obliga a hacer scroll para ver las opciones y el botón.

**Problemas de comprensión**
- «¿En qué estado está?»: no dice de qué (de la palmera/el grupo).
- «Altura del tronco»: la descripción «mide solo el tronco, hasta donde empiezan las hojas» es clave y se lee poco.

**Campos con demasiada carga cognitiva**
- Especie: 6 nombres científicos.

**Campos que deberían agruparse**
- Estado y número se pueden quedar separados. Los extras ya van juntos.

**Campos que deberían separarse visualmente**
- El extra recomendado (activado) de los opcionales.

**Interacciones mejorables**
- Altura con selector segmentado de chips cortos (2-4 opciones cortas).
- Aviso explícito si la altura se reinicia al cambiar de especie.

**Feedback y validación**
- Resumen: «Número de palmeras 1 ud» (abreviatura innecesaria); plural roto con dos grupos: «grupo de palmerass».

**Oportunidades de mejora**
- Foto o silueta por especie (la ronda anterior la tenía anotada como pendiente; requiere imágenes: D-06).

**Qué mantendría exactamente igual:** los `value` de especie (nombres latinos, `'Washingtonia robusta/filifera'`), las bandas por especie, `state`, `quantity` 1–50 con defecto 1, `hasPhytosanitary` activado por defecto, las reglas de especie (`speciesSupports*`).
**Qué reorganizaría:** nombre común como etiqueta principal y latín como secundario; extra recomendado arriba y separado.
**Qué rediseñaría:** especie (lista con nombre común), altura (segmentado), extras (filas enteras pulsables).
**Qué simplificaría visualmente:** el texto del fitosanitario (una línea + «Por qué» plegado).
**Qué comportamiento cambiaría:** ocultar «Acceso difícil» en el tramo más bajo (solo presentación: el constructor ya lo ignora); aviso al reiniciarse la altura.
**Qué NO debe tocarse:** `buildPalmGroups`, `PALM_HEIGHT_RANGES_BY_SPECIES`, `speciesBusinessRules.ts`, el defecto del fitosanitario.

### 3.5 Poda de plantas y arbustos

**Recorrido:** superficie (slider 1–2000) → tamaño dominante (3) → estado (3) → retirada → resumen.

**Problemas de UX**
- Slider 1–2000 m² para macizos que suelen medir 3-50 m²: el pulgar no se separa del borde.
- «Tamaño dominante» obliga a promediar mentalmente un macizo mixto; la pregunta («¿De qué tamaño son las plantas predominantes?») lo dice, pero la etiqueta del resumen no.

**Problemas de UI**
- Tarjetas de 197-221 px; huérfana en las dos pantallas de 3 opciones; 3 textos desbordan en tamaño.

**Problemas de jerarquía**
- La pantalla de superficie no tiene ayuda, solo el ejemplo (cama de matrimonio ≈ 3 m²), que es bueno pero queda en gris claro al final.

**Problemas de orden**
- Correcto.

**Problemas específicos de móvil**
- «Siguiente» en y = 1003 en tamaño.

**Problemas de comprensión**
- Referencias corporales (rodilla / cintura o pecho / cabeza): buenas, pero «cintura o el pecho» es un rango ambiguo. Mejor una sola referencia por tramo (D-03).
- Iconos del tamaño (`Sprout` → `Shrub` → `TreePine`): un pino para «arbustos grandes» confunde.

**Campos con demasiada carga cognitiva**
- Superficie de plantas: más difícil de estimar que un césped (formas irregulares).

**Campos que deberían agruparse**
- Ninguno.

**Campos que deberían separarse visualmente**
- La referencia de medida, bajo el campo.

**Interacciones mejorables**
- Campo numérico con valores habituales visibles como referencia («un macizo pequeño ≈ 3 m²; una jardinera larga ≈ 10 m²»).

**Feedback y validación**
- Mismo patrón de error que césped.

**Oportunidades de mejora**
- Es casi un calco estructural de césped: al final, sale casi gratis aplicando el patrón.

**Qué mantendría exactamente igual:** `superficie_m2` 1–2000, `tamano_dominante` (`pequeñas`/`medianas`/`grandes` con eñe), `estado_plantas`.
**Qué reorganizaría:** referencia de medida bajo el campo.
**Qué rediseñaría:** control de superficie y listas de opciones.
**Qué simplificaría visualmente:** iconografía del tamaño (misma progresión que los demás tamaños).
**Qué comportamiento cambiaría:** el de todo el sistema (errores, CTA fijo).
**Qué NO debe tocarse:** `buildShrubGroups`, `stateProposedByAI: false`.

### 3.6 Servicios fitosanitarios

**Recorrido:** qué tratar (5) → cantidad (stepper) → tamaño* (3) → preventivo/curativo (2) → qué combatir* (3) → producto (2) → setos altos* (interruptor) → endoterapia* (interruptor) → «¿Añadir otra zona?» → resumen. Hasta **7 pantallas por zona**. Sin retirada (correcto: no se factura).

**Problemas de UX**
- **La cantidad no dice en qué unidad está** (P-08 de comprensión, con efecto en precio). El campo se llama «Cantidad a tratar», sin unidad visible, y la descripción explica a la vez tres unidades («m² en césped y plantas, metros en setos, ejemplares en árboles y palmeras»). El motor interpreta `area` como m², metros lineales o unidades según el tipo (`derivePhytosanitaryMetricsFromZone`). Quien trata 3 árboles y escribe «30» porque piensa en m² paga diez árboles.
- Stepper de 1 a 5000 con paso 1: para 300 m² hacen falta 300 toques o escribir en un campo sin caja visible (NN/g: los steppers no sirven para ajustes grandes).
- **El total de pasos cambia mientras se avanza** («1 de 4» → «2 de 5» → «5 de 6»): el progreso se siente como una trampa.
- Dos pantallas enteras para un solo interruptor (setos altos, endoterapia).

**Problemas de UI**
- Qué tratar: 5 tarjetas (175/175/128/128/106 px), la última sola.
- «Qué combatir»: 3 tarjetas, huérfana.

**Problemas de jerarquía**
- La pregunta de intención («preventivo o curativo») y su consecuencia («¿qué quieres combatir?») están en pantallas separadas, aunque la segunda solo existe por la primera.

**Problemas de orden**
- «Tamaño» aparece después de «cantidad» (bien: «cuántos y de qué tamaño»), pero en pantallas distintas.

**Problemas específicos de móvil**
- «Siguiente» en y = 998 en la primera pantalla.

**Problemas de comprensión**
- Escalas de tamaño distintas para el mismo objeto: en fitosanitarios «árbol grande» es más de 6 m; en poda de árboles «grande» es de 5 a 9 m y «muy grande» más de 9 m. Son datos distintos (no se tocan), pero el cliente que reserva los dos servicios ve dos escalas: hay que mostrar siempre el número.
- «Ecológico (puede tener recargo)»: vago.

**Campos con demasiada carga cognitiva**
- Cantidad (unidad implícita) y el flujo completo (hasta 7 decisiones por zona).

**Campos que deberían agruparse**
- Cantidad + tamaño (o + «¿supera 2 m?» en setos) en una pantalla: «¿Cuántos y de qué tamaño?».
- Intención + objetivo (revelado condicional dentro de la misma pantalla, patrón de GOV.UK).
- Endoterapia dentro de la pantalla de tratamiento cuando se trata de palmeras.

**Campos que deberían separarse visualmente**
- Producto (preferencia) de tratamiento (necesidad).

**Interacciones mejorables**
- Unidad y título de la cantidad adaptados al tipo elegido: «¿Cuántos árboles hay que tratar? — ejemplares», «¿Cuántos metros de seto? — m», «¿Cuántos m² de césped? — m²». Mismo dato `area`, otra presentación.
- Campo numérico en vez de stepper.

**Feedback y validación**
- Resumen: «Cantidad a tratar 3», sin unidad.

**Oportunidades de mejora**
- Pasar de hasta 7 pantallas a 4 sin quitar ninguna pregunta.

**Qué mantendría exactamente igual:** `affectedType` (valores con tilde, `'Plantas bajas'`), `area` 1–5000, `sizeBand` por tipo, `intent`, `curativeTarget`, `productPreference`, `aboveThreeMeters` (etiquetado «Supera los 2 m»), `wantsEndotherapy`, la ausencia de retirada.
**Qué reorganizaría:** 4 pantallas: qué tratar → cuántos y de qué tamaño → tratamiento (con objetivo revelado y endoterapia) → producto.
**Qué rediseñaría:** el control de cantidad (campo con unidad dinámica) y la presentación condicional.
**Qué simplificaría visualmente:** las pantallas de un solo interruptor.
**Qué comportamiento cambiaría:** progreso que nunca crece (ver `SISTEMA-UX.md` §6.9).
**Qué NO debe tocarse:** `buildPhytosanitaryZones` (incluida la conversión a `requestedTreatment` y `type`), las métricas del motor, las respuestas ocultas que quedan en el borrador (el constructor y el motor ya las ignoran: ver P-05).

### 3.7 Desbroce de malas hierbas

**Recorrido:** superficie (slider 1–10000) → dificultad (3) → herbicida (interruptor) → retirada → resumen. **Es solo manual**: el 100 % de las reservas de desbroce pasan por este formulario.

**Problemas de UX**
- Slider 1–10000 m²: cada píxel del recorrido vale ≈ 33 m². Inutilizable con el dedo.
- **Retirada de restos heredada de otro servicio (P-02).** Reproducido con una reserva de 5 servicios: tras confirmar fitosanitarios (que fija `wasteRemoval=false` porque no la factura), el desbroce arrancó con la retirada en «No». El asistente toma como inicial `bookingData.wasteRemoval`, que es global. El cliente que no mira la pantalla contrata sin retirada sin haberlo elegido.
- Herbicida y retirada: dos pantallas de un solo interruptor, seguidas.

**Problemas de UI**
- Tarjetas de dificultad de 243/243/174 px.
- Sin selector de fotos, el asistente queda arriba (y = 165), mejor que en los demás. Pero tampoco hay título de servicio con un solo servicio.

**Problemas de jerarquía**
- «¿Quieres aplicar herbicida?» con la ayuda genérica «servicio adicional»: no dice qué implica ni que tiene coste.

**Problemas de orden**
- Correcto.

**Problemas específicos de móvil**
- El slider es el peor de los 7 formularios.

**Problemas de comprensión**
- «Dificultad normal/media/alta» describe el terreno, no el estado: vocabulario distinto del resto de servicios, y **está justificado** (el dato es otro). Las ayudas son concretas (altura de maleza, zarzas, escombros): buenas.

**Campos con demasiada carga cognitiva**
- Superficie de parcela: es el caso de m² más grande y el cliente suele conocerla por la escritura o el catastro. Ayuda útil: «si la conoces por la escritura o el catastro, usa esa cifra».

**Campos que deberían agruparse**
- Herbicida + retirada en «Opciones del servicio» (dos elecciones explícitas en una pantalla, emitiendo ambos `stepId`).

**Campos que deberían separarse visualmente**
- —

**Interacciones mejorables**
- Campo numérico con separador de miles al mostrar («2.500 m²»).

**Feedback y validación**
- «10000 m²» sin separador.

**Oportunidades de mejora**
- Al ser el único servicio sin alternativa, es donde más rinde en conversión cualquier mejora.

**Qué mantendría exactamente igual:** `area` 1–10000, `state` (`normal`/`dificultad_media`/`dificultad_alta`), `applyHerbicide` desactivado por defecto, las etiquetas de dificultad.
**Qué reorganizaría:** opciones (herbicida + retirada) juntas.
**Qué rediseñaría:** control de superficie y lista de dificultad.
**Qué simplificaría visualmente:** dos pantallas de un interruptor → una.
**Qué comportamiento cambiaría:** la retirada nunca se hereda de otro servicio (P-02, pendiente de aprobación: D-02).
**Qué NO debe tocarse:** `buildWeedingZones`, `isManualOnlyService`, el cobro por `suplementos.retirada_restos`.

---

## 4. Comparativa transversal entre formularios

### 4.1 Problemas del shell compartido (afectan a los 7)

| ID | Problema | Evidencia |
|---|---|---|
| T-01 | Doble progreso («Paso 3 de 5» + «Paso X de Y») y contador interno que no cuenta retirada ni resumen, y en fitosanitarios crece | Recorrido real |
| T-02 | Sin nombre del servicio en las preguntas cuando la reserva tiene un solo servicio | `DetailsPage.tsx` oculta el bloque de fotos con su título |
| T-03 | El selector fotos/manual ocupa ≈ 300 px del primer pliegue durante todo el asistente | Medidas §2 |
| T-04 | CTA al final del contenido (fuera del pliegue en 6 de 7 servicios); el modo fotos lo tiene fijo | Medidas §2 |
| T-05 | Tarjetas en 2 columnas fijas: textos desbordados, alturas de 58 a 266 px, huérfanas | Medidas §3 |
| T-06 | El check que aparece al seleccionar recoloca el texto (salto de maquetación); alineación vertical distinta entre tarjetas de la misma fila | Setos «caras» |
| T-07 | Error lejos del campo (al final de la ayuda), sin estado de error en el campo (ni borde ni `aria-invalid`), sin foco en el error, «Siguiente» deshabilitado; mensajes sin artículo | Césped |
| T-08 | `type="number"` en todos los numéricos (coma decimal en iOS, rueda del ratón, lectores de pantalla); campo sin caja; slider con pulgar en el mínimo cuando el campo está vacío | Código + recorrido |
| T-09 | Sliders lineales de rangos enormes (1–200, 1–2000, 1–5000, 1–10000) | NN/g §5 |
| T-10 | Stepper con paso que no casa con la rejilla (setos) y stepper para rangos grandes (fitosanitarios) | Setos, fitosanitarios |
| T-11 | Interruptor: solo el switch (48 × 28 px) es pulsable; la fila y el texto no | `ManualFieldRenderer` toggle |
| T-12 | «Cambiar a fotos» de 24 px de alto; «Atrás» visible y **sin efecto** en la primera pregunta; «Atrás» a ancho completo compite con la acción principal | Medidas |
| T-13 | Resumen: tarjetas dentro de tarjeta, titulares torpes («Datos de zona de césped», «Datos de parcela»), «Editar» vuelve al principio del elemento, booleanos como «Sí/No» en vez de lo elegido, decimales con punto, «ud», aviso de casilla lejos del botón | Recorrido |
| T-14 | Repetibles sin eliminar, «Atrás» que no descarta el elemento vacío (P-01), plurales rotos («árbols», «palmerass», «tratamientos»), pantalla intermedia sin «Atrás» ni lista | Árboles |
| T-15 | Retirada de restos: título duplicado (no usa la pregunta del schema), ayuda en negativo, sin mención de coste, y valor inicial heredado de otro servicio (P-02) | Desbroce |
| T-16 | Aviso «Verás el precio…» repetido en todas las pantallas | — |
| T-17 | Iconos que no discriminan: `Sprout` significa «césped», «normal» y «pequeño»; 6 especies con el mismo icono; `Square` parece una casilla; `Ruler` en todas las alturas | Schema |
| T-18 | Descripción y ayuda que repiten la misma frase | Setos, césped |
| T-19 | Al recargar se vuelve a la pregunta 1 (las respuestas se conservan) | Recorrido |
| T-20 | Accesibilidad: barra de progreso sin nombre, selector sin `radiogroup`, errores sin `aria-invalid`, hover que se queda pegado en táctil (`hover:` sin `@media (hover)`) | Código |
| T-21 | Números sin formato es-ES («5000», «10000», «2.3») | Recorrido |
| T-22 | Anidación: fondo gris → tarjeta con borde y sombra → tarjetas con borde (y sombra en el resumen) | Recorrido |

### 4.2 Inconsistencias entre formularios

| Aspecto | Qué se ve hoy | Por qué es un problema |
|---|---|---|
| Control para cantidades | slider (césped, setos-longitud, arbustos, desbroce), stepper (setos-altura, palmeras, fitosanitarios-cantidad) | La misma clase de dato (m², m) se introduce de dos formas; fitosanitarios usa stepper para 1–5000 |
| Unidad | «m²» bajo el campo (slider), «m»/«ud» bajo el número (stepper), **ninguna** en fitosanitarios | La unidad debe estar siempre en el mismo sitio, dentro del campo |
| Dificultad de acceso | Pantalla propia con 2 tarjetas (árboles) vs. interruptor dentro de «Opciones adicionales» (palmeras) | El mismo concepto se pregunta de dos maneras |
| Extras opcionales | Pantalla propia por interruptor (desbroce herbicida, fitosanitarios setos/endoterapia) vs. varios en una pantalla (palmeras) | Sin criterio |
| Títulos | Casi todos preguntas en 2ª persona; excepciones: «Opciones adicionales», «Retirada de restos», «¿En qué estado está?» | Rompe la voz |
| Vocabulario de estado | Normal/Descuidado(a)(s)/Muy descuidado(a)(s): bien. Desbroce usa Dificultad normal/media/alta | Justificado (otro dato); se mantiene |
| Escalas de tamaño | Árboles: 0-3/3-5/5-9/>9 m; fitosanitarios-árboles: ≤3/3-6/>6 m; palmeras por especie; arbustos por referencia corporal | Datos distintos que no se tocan: hay que mostrar siempre el número y una sola referencia coherente |
| Iconos de tamaño | Árboles `Sprout→TreeDeciduous→TreePine→Trees`; arbustos `Sprout→Shrub→TreePine`; fitos-árboles `Sprout→Trees→TreePine` | La misma progresión («pequeño → grande») con iconos distintos y a veces invertidos |
| Ayuda de campos numéricos | Césped: help + example; setos: help + example; arbustos: solo example; desbroce: solo example; palmeras-número: nada; fitosanitarios-cantidad: nada | Igualar hacia arriba |

### 4.3 Qué debería ser reutilizable (hoy no lo es) y qué debería ser distinto

**Reutilizable:** una sola lista de opciones de 1 columna, un solo campo numérico con
unidad y coma decimal (la lógica ya existe en `src/components/gardener/UnifiedNumericInput.tsx`,
hoy solo para jardineros), una sola fila de interruptor, un solo bloque de error, un pie
fijo de navegación, un resumen del tipo «revisar respuestas» con «Cambiar» por fila, una
lista de elementos para los repetibles y una cabecera de pregunta.

**Debe seguir siendo distinto:** el número de preguntas y su agrupación por servicio,
el control para la altura del seto (stepper con rejilla: hay tramos) frente a la
superficie (campo libre), la altura de palmera (segmentado dependiente de la especie), la
unidad dinámica de fitosanitarios, las referencias de medida de cada servicio y el
vocabulario de dificultad del desbroce.

**Principio:** el mismo sistema y los mismos patrones, con instancias distintas por
servicio. No se trata de que los formularios sean iguales.

---

## 5. Investigación de buenas prácticas (y cómo se aplica aquí)

| Práctica | Fuente | Aplicación en GarSer |
|---|---|---|
| Una cosa por página, entendiendo «cosa» como una tarea o decisión, no un campo; funciona mejor en móvil y con usuarios poco seguros, y maneja mejor errores, ramas y bucles | [GOV.UK Design Notes — One thing per page](https://designnotes.blog.gov.uk/2015/07/03/one-thing-per-page/); [Smashing — One thing per page](https://www.smashingmagazine.com/2017/05/better-form-design-one-thing-per-page/); [MoJ — Question pages](https://design-patterns.service.justice.gov.uk/archive/question-pages) | Mantener el asistente paso a paso, pero agrupar lo que es una sola tarea (medidas del seto; cuántos y de qué tamaño; tratamiento y su objetivo; opciones del servicio) |
| Revelado condicional de preguntas de seguimiento dentro de la misma pantalla | [GOV.UK — Radios](https://design-system.service.gov.uk/components/radios/) | «Curativo» revela «¿qué combatir?» en la misma pantalla |
| No usar `type="number"`: `type="text"` + `inputmode="numeric"`/`decimal` por problemas de accesibilidad, redondeo y rueda | [GOV.UK Technology blog](https://technology.blog.gov.uk/2020/02/24/why-the-gov-uk-design-system-team-changed-the-input-type-for-numbers/); [GOV.UK — Text input](https://design-system.service.gov.uk/components/text-input/) | Campo numérico nuevo con coma decimal y teclado numérico, reutilizando el parseo de `UnifiedNumericInput` |
| Los sliders son imprecisos en móvil; combinar con entrada de texto cuando importa la precisión | [NN/g — Sliders, knobs and matrices](https://www.nngroup.com/articles/sliders-knobs/); [Smashing — Slider UX](https://www.smashingmagazine.com/2017/07/designing-perfect-slider/) | Quitar los sliders de superficie/longitud; el dato es preciso y cambia el precio |
| Los steppers sirven para ajustes pequeños desde un defecto claro; no para rangos grandes; objetivos táctiles grandes; combinarlos con campo editable | [NN/g — Input steppers](https://www.nngroup.com/articles/input-steppers/) | Stepper solo en número de palmeras (1–50, defecto 1) y altura de seto (con rejilla); fuera de fitosanitarios |
| Errores junto al campo que los causa, específicos y cuando se termina el campo (no mientras se teclea) | [Baymard — Inline validation](https://baymard.com/blog/inline-form-validation); [GOV.UK — Error message](https://design-system.service.gov.uk/components/error-message/) | Validar al salir del campo y al pulsar «Siguiente»; mensaje bajo el campo, `aria-invalid`, foco al primer error |
| Etiquetas visibles encima del campo, nunca dentro | [Baymard — Mobile forms: avoid inline labels](https://baymard.com/blog/mobile-forms-avoid-inline-labels) | Etiqueta visible siempre (hoy el campo numérico solo tiene `aria-label`) |
| Objetivos táctiles: mínimo WCAG 2.2 AA de 24 px; recomendado 44 pt (Apple) / 48 dp (Material) | [TetraLogical — Target size](https://tetralogical.com/blog/2022/12/20/foundations-target-size/); [Adrian Roselli](http://adrianroselli.com/2019/06/target-size-and-2-5-5.html) | Todo lo pulsable ≥ 44 px de alto; filas de opción ≥ 56 px |
| Zona del pulgar: la acción principal abajo, al alcance; barra fija | [UX Movement — Mobile CTA placement](https://uxmovement.com/mobile/optimal-placement-for-mobile-call-to-action-buttons/); [Parachute — Thumb zone](https://parachutedesign.ca/blog/thumb-zone-ux/) | Pie fijo con «Siguiente», igual que el CTA fijo del modo fotos |
| Asistentes: pasos en orden, estado visible, «Paso X de Y» honesto | [NN/g — Wizards](https://www.nngroup.com/articles/wizards/); [ESDC — Multi-step forms](https://bati-itao.github.io/learning/esdc-self-paced-web-accessibility-course/module6/multi-step-forms.html) | Un solo indicador dentro del asistente («Pregunta X de Y») que nunca crece |
| Resumen tipo «revisar respuestas» con cambio por fila | Patrón *Check answers* de GOV.UK (familia *Question pages*) | Resumen con «Cambiar» que lleva a esa pregunta y vuelve al resumen |

---

## 10. Riesgos y puntos que podrían afectar al precio

| ID | Punto | Estado hoy | Qué se propone | ¿Toca contrato? |
|---|---|---|---|---|
| P-01 | Elemento repetible vacío que se envía y se cobra con los defaults del constructor (árbol `small`/`structural`; en palmeras/fitosanitarios fallaría la validación o saldría otro default) | **Reproducido en árboles** | Interfaz: «Atrás» descarta el recién añadido vacío; eliminar elemento; el resumen bloquea «Confirmar» con elementos incompletos. **El constructor no se toca** | No: se dejan de enviar datos que el cliente no declaró |
| P-02 | La retirada de restos se hereda del servicio anterior (queda en «No» tras fitosanitarios) | **Reproducido** | Valor inicial = borrador del propio servicio → default del schema (`true`); nunca `bookingData.wasteRemoval` de otro servicio | Cambia un **valor inicial** que decide un recargo → **requiere aprobación (D-02)** |
| P-03 | El stepper de altura de seto no puede dar 2,0 m (tramo) | Reproducido | Botones ± que ajustan a la rejilla de 0,5; escribir sigue libre | No (mismo campo, mismo rango) |
| P-04 | «Acceso difícil» de palmeras visible en el tramo bajo, donde el constructor lo ignora | Código | Ocultarlo en ese tramo, solo en la capa de presentación | No |
| P-05 | Respuestas de preguntas que dejan de verse (curativo → preventivo; cambio de tipo en fitosanitarios; cambio de especie) siguen en el borrador | Verificado en código: constructor y motor las ignoran (`curativeTarget` solo si curativo; `sizeBand` ignorado en césped/setos; bandas de palmera revalidadas; extras de especie filtrados) | **No limpiar**: cambiaría `declaredVariables` (registro legal) sin beneficio de precio. Solo cuidar la presentación | — |
| P-06 | Telemetría `booking.manual_entry_step_completed` con `stepId` | — | Al agrupar pantallas, emitir todos los `stepId` de la pantalla, en el orden del schema | No |
| P-07 | El schema lo empaquetan `booking-authority` y `booking-manual-declaration` | — | No editar `manualEntrySchema.ts` / `manualEntryValidation.ts`; la presentación va en una capa de cliente | Si se editara: redesplegar funciones |
| P-08 | Unidad de la cantidad de fitosanitarios (m² / m / ejemplares) invisible | Recorrido | Unidad y título dinámicos por tipo (solo presentación) | No (el dato `area` es el mismo) |
| P-09 | Cambio de `type="number"` a texto con coma | — | El número resultante debe ser idéntico (tests de parseo: «2,5» → 2.5; «1.000» en superficie → 1000, **decisión D-07**) | No, si los tests lo garantizan |
| P-10 | Corrección automática al salir del campo | — | **No corregir en silencio** (6000 → 5000 cambiaría un dato de precio sin que el cliente lo vea): mostrar el error y dejar que corrija | — |
| P-11 | Rango de césped 1–5000 m² en el código frente a «1–2000» en la documentación de la skill | Código | No se toca; se anota en `HALLAZGOS-NUEVOS.md` | — |
| P-12 | Árboles sin cantidad en manual (fotos sí agrupa) | Código | Fuera de alcance (dato). Alternativa de interfaz: «Duplicar este árbol» (D-04) | «Duplicar» no toca contrato (N elementos idénticos) |
| P-13 | Fitosanitario de palmeras activado por defecto | Decisión de negocio vigente | Se mantiene; mejor presentado («Recomendado», con coste explícito) | No |
| P-14 | Corrección del jardinero en la visita usa el mismo asistente (`BookingRequestsManager.tsx:791`) | Código | Toda fase que toque el shell se verifica también allí («Recalcular precio» con el mismo importe) | — |
