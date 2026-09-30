# Plan de implementación — formularios manuales de «Detalles»

Base: `AUDITORIA.md` (hallazgos T-xx, P-xx) y `SISTEMA-UX.md` (sistema y componentes).
Todas las fases siguen `REGLAS.md` y cierran con la puerta de `METODO-Y-PRUEBAS.md`.
**Nada se implementa hasta que el usuario apruebe este plan y responda a §0.**

---

## 0. Decisiones que necesito del usuario antes de empezar

| ID | Decisión | Mi recomendación | Por qué importa |
|---|---|---|---|
| D-01 | Arquitectura: capa de presentación solo de cliente; `manualEntrySchema.ts` y `manualEntryValidation.ts` intactos | **Sí** | Evita redesplegar Edge Functions y blinda el contrato |
| D-02 | P-02: la retirada de restos deja de heredarse de otro servicio (valor inicial = borrador del servicio → `true` del schema) | **Sí** | Cambia un valor inicial que decide un recargo. Hoy, tras fitosanitarios, arranca en «No» sin que el cliente lo elija |
| D-03 | Reescribir referencias de medida sin cambiar tramos: árboles por plantas de edificio (p. ej. «Mediano 3–5 m: hasta la altura de un primer piso»), arbustos con una sola referencia por tramo | **Sí**, con el texto final aprobado por ti en la fase del servicio | El cliente elige por la referencia: hoy hay referencias incoherentes que le llevan a otro tramo |
| D-04 | Árboles: botón «Duplicar este árbol» en la lista (crea N elementos idénticos; no añade `quantity`) | **Sí** | 5 árboles iguales = 15 pantallas hoy. No toca contrato |
| D-05 | Agrupar pantallas que son una sola tarea: medidas del seto (longitud + altura); fitosanitarios «cuántos y de qué tamaño» y «tratamiento + objetivo (+ endoterapia)»; desbroce «opciones» (herbicida + retirada). Se siguen emitiendo todos los `stepId` | **Sí** | Setos 6 → 5 pantallas; fitosanitarios hasta 7 → 4; desbroce 5 → 4 |
| D-06 | Palmeras: silueta o foto por especie | **Más adelante** (requiere imágenes con licencia) | Sin imágenes el plan funciona con nombre común + latín |
| D-07 | Separador de miles en superficies: «1.000» se lee como 1000 solo si el punto va seguido de exactamente 3 cifras; se muestra la lectura en vivo («= 1.000 m²») | **Sí** | Hoy «1.000» se lee como 1 (m²) |
| D-08 | «Atrás» en la primera pregunta: quitarlo del pie (la cabecera de la página ya vuelve atrás) | **Sí** | Hoy es un botón sin efecto |
| D-09 | Retirada de restos como dos opciones explícitas («Sí, que se lleven los restos» / «No, me encargo yo») en lugar de un interruptor preactivado | **Sí** | Mismo booleano y mismo defecto; decisión con coste visible |
| D-10 | Palmeras: nombre común como etiqueta principal (Palmera canaria, Palmera datilera, Washingtonia o palmera de abanico, Pindó, Palmera de molino, Palmera real) y latín debajo | **Sí** | Los `value` no cambian |
| D-11 | Plegar el selector fotos/manual a una línea una vez elegido el modo manual | **Sí** | Libera ≈ 250 px del primer pliegue. Puede bajar algo el uso de fotos: se mide con la telemetría existente |

### 0.1 Respuestas del usuario (2026-09-30)

| ID | Respuesta | Efecto en el plan |
|---|---|---|
| D-01 | Sí | Capa de presentación de cliente; schema y validación intactos |
| D-02 | Sí | F4 cambia `initialWasteRemoval` en `DetailsPage` (única diferencia de huella permitida, documentada) |
| D-03 | **No. Quitar por completo las referencias, porque no son fiables** | Fuera todas las comparaciones con objetos, cuerpo o edificios (puerta, planta de edificio, tejado, rodilla, cintura, pecho, cabeza, plaza de garaje, pista de pádel, coche, cama, parcela urbana, «1 paso ≈ 0,8 m»). Se conservan los **rangos numéricos** y las **instrucciones de cómo medir** («mide solo el tronco», «suma los tramos si hace esquinas», «desde el suelo hasta lo más alto»). «¿Cómo lo mido?» pasa a contener solo el método. Ver D-12 para las opciones que se quedan sin criterio |
| D-04 | Sí | F6: «Duplicar este árbol» |
| D-05 | Sí | Agrupaciones en F5, F8 y F9, emitiendo todos los `stepId` |
| D-06 | **Sí** (imágenes por especie de palmera) | Entra en F7. Hace falta una fuente de imágenes (ver D-13) |
| D-07 | Sí | F1: «1.000» = 1000 en superficies, con lectura en vivo |
| D-08 | Sí | F2: sin «Atrás» en la primera pregunta |
| D-09 | Sí | F4: retirada como dos opciones explícitas |
| D-10 | Sí | F7: nombre común + latín |
| D-11 | Sí | F2: selector plegado en modo manual |

### 0.2 Decisiones nuevas que salen de las respuestas

| ID | Decisión | Mi recomendación | Cuándo hace falta |
|---|---|---|---|
| D-12 | Al quitar las referencias (D-03), hay opciones de tamaño que **se quedan sin criterio**, porque solo se definían por comparación: arbustos (pequeñas/medianas/grandes) y plantas, palmeras y setos de fitosanitarios. Y los rangos que hoy ve el cliente en fitosanitarios **no coinciden** con los que el jardinero usa para fijar su precio (H-N-09). Propuesta: mostrar al cliente **los mismos rangos en metros que ve el jardinero** en su configurador (arbustos 0–1 / 1–2 / 2–3 m; fitos-palmeras < 3,5 / 3,5–8 / > 8 m; fitos-plantas < 0,5 / 0,5–1,5 / 1,5–2 m; fitos-setos altos 2,5–5 m). Los valores enviados no cambian; cambia el criterio con el que el cliente elige, y eso puede cambiar qué tramo escoge | Sí, alinear con el jardinero, porque es la definición con la que él cobra | Antes de F8 (fitosanitarios) y F11 (arbustos) |
| D-13 | Imágenes de palmeras (D-06): ¿de dónde salen? (a) fotos propias o con licencia que me pases, (b) siluetas SVG sencillas dibujadas para GarSer, (c) banco libre (Unsplash/Pexels, licencia a verificar) | (b) siluetas propias: ligeras, coherentes con Lucide y sin problemas de licencia. Si hay fotos propias, mejor (a) | Antes de F7 |

---

## Pre-fase — Entorno limpio, duplicado real de producción y línea base

**Objetivo.** Trabajar sobre una copia comprobada de lo que hay en producción y dejar
medida la línea base (visual, de envío y de precio) contra la que se compara cada fase.

**Estado al redactar este plan (2026-09-30):**
- Hecho: rama `feat/formularios-manuales-ux-v2` desde `origin/main` (81397be); ramas y
  cambios de la ronda anterior borrados (SHA en `README.md`); tests de la zona manual en
  verde (146/146; 5 snapshots obsoletos en el test de paridad, ver H-N-03).
- Visto: el Supabase local (`supabase_*_GarSer-main_4`) está levantado pero **le faltan
  3 migraciones** del 29-09 (`20260929120000`, `…130000`, `…140000`). El `edge_runtime`
  se había reiniciado hacía un minuto (otra sesión). En 5173 y 5190 hay servidores de
  desarrollo lanzados por otras sesiones desde este mismo checkout.
- Visto: hay dos sesiones pares con temas parecidos, inactivas («Diseño formularios
  reservas manual», local, hace 1 día; «Auditoría UX/UI formularios GarSer.es», nube). El
  MCP de Supabase no conecta en esta sesión (se usa la CLI).

**Pasos:**

| # | Paso | Cómo se comprueba |
|---|---|---|
| PRE-1 | Coordinación: que ninguna otra sesión edite este checkout ni reinicie el stack durante la ronda (archivar o cerrar las dos sesiones pares; parar los servidores de 5173/5190 si no son necesarios) | `lsof` de puertos; `git status` limpio al empezar cada fase |
| PRE-2 | Producción = `origin/main`: comprobar que el despliegue de garser.es corresponde a 81397be (panel de Vercel o `vercel ls`), que las migraciones de producción coinciden con el repo (`supabase migration list --linked`) y qué versión de `booking-authority`/`booking-manual-declaration` está desplegada (`supabase functions list`) | Tabla en `qa/pre-fase.md`; cualquier diferencia pasa a `HALLAZGOS-NUEVOS.md` y se resuelve antes de F1 |
| PRE-3 | Duplicado de referencia: worktree `~/Downloads/auditorias/formularios-main` en `origin/main` (sin cambios nunca), con `.env.local` copiado y `node_modules` enlazado, sirviendo en **5192**. La rama sirve en **5191** (rango de reserva, ver memoria de montaje) | Las dos URLs cargan; `git -C … rev-parse HEAD` = 81397be |
| PRE-4 | Supabase local al día: `supabase migration up`, `supabase stop && supabase start` (si Docker se cuelga, ver memoria del *workaround*) para que las Edge Functions monten el código de `origin/main`; comprobar permisos de `service_role` | Última migración local = última del repo; `booking-authority` devuelve jardineros con precio |
| PRE-5 | Datos semilla: cliente y jardinero de `supabase/seed.sql`, jardinero con los 7 servicios configurados y cobertura en la dirección de prueba (Av. Ricardo Soriano 12, Marbella) | La pantalla «Profesionales» muestra precio para los 7 servicios |
| PRE-6 | Claves y banderas: `VITE_SUPABASE_URL` local, `VITE_ENABLE_MANUAL_BOOKING_INPUT=true`, clave de Maps (el autocompletado funciona), claves **de prueba** de Stripe en local. El pago con tarjeta de prueba **se vuelve a pedir** al usuario cuando haga falta (la autorización A-01 era de la ronda anterior) | Recorrido hasta «Profesionales» sin errores de consola |
| PRE-7 | Permisos y herramientas: panel del navegador en localhost, Playwright del banco (`scripts/qa/manual-entry/README.md`), `npx tsc` y `vitest` operativos | Los tres ejecutan |
| PRE-8 | **Línea base** (en `qa/linea-base.md`): `tsc` (número de errores preexistentes), `vitest` completo, paridad de precio (88 casos), banco visual en 6 anchos × 7 servicios, envío del banco (0 diferencias), y E2E local: por servicio un juego fijo de respuestas → precio por profesional en «Profesionales» + huella SHA-256 de la colección guardada; más una corrección del jardinero («Recalcular precio») | Archivo con los números; capturas en `qa/linea-base/` |

**Criterio de salida:** PRE-1…PRE-8 en verde y anotados en `PROGRESO.md`. Sin esto no empieza F1.
**Riesgos:** Docker colgado (hay *workaround*); datos semilla sin los 7 servicios (se completan con el configurador en local, nunca en producción).
**No se modifica:** ningún archivo de `src/`, `supabase/` ni configuración de producción.

---

## F1 — Cimientos sin cambio visible

**Objetivo.** Crear la capa de presentación y las utilidades puras, reproduciendo el
comportamiento **actual** exacto, para que las fases siguientes cambien la interfaz
sin tocar la lógica.

**Archivos:** nuevos `src/components/booking/manual/presentation/{manualEntryPresentation.ts, screens.ts, formatManualValue.ts}` y tests; extracción del parseo numérico de `UnifiedNumericInput.tsx` a una función compartida (con el configurador apuntando a ella).

**Cambios concretos:**
- `screens.ts`: dado el survey, las respuestas y la presentación, devuelve las pantallas visibles, los `stepId` de cada una y «Pregunta X de Y» con la regla de `SISTEMA-UX.md` §6.9. En F1 la presentación declara **una pantalla por paso** (igual que hoy).
- `formatManualValue.ts`: es-ES (miles con punto, decimal con coma, unidades, booleanos por etiqueta de opción).
- Parseo numérico compartido con tests: «2,5» → 2.5, «2.5» → 2.5 en campos decimales, «1.000» → 1000 en superficies (D-07), vacío → `undefined`.

**Dependencias:** Pre-fase. **Riesgos:** romper el configurador del jardinero al extraer el parseo → tests de `UnifiedNumericInput` antes y después.
**No se modifica:** schema, validación, constructores, motor, `DetailsPage` (salvo nada), `legalCopy.ts`.
**Aceptación:** banco visual con **0 diferencias** frente a la línea base; paridad 88/88 idéntica; tests nuevos en verde; `tsc` sin errores nuevos.
**Precio:** no puede cambiar (no hay cambio visible). Se comprueba con la paridad y el envío del banco.

## F2 — Carcasa y navegación (afecta a los 7 + corrección del jardinero)

**Objetivo.** Resolver T-01, T-02, T-03, T-04, T-12, T-16, T-19 (opcional), T-20 (parte), T-22.

**Archivos:** `ManualEntryWizard.tsx`, `ManualEntryChoice.tsx` (variante plegada), nuevos `ui/ManualStepHeader.tsx`, `ui/WizardFooter.tsx`; `DetailsPage.tsx` solo en el montaje (pasar el nombre del servicio y el modo plegado; nada del envío).

**Cambios concretos:** eyebrow «Servicio · Pregunta X de Y»; una sola barra (la de la reserva); selector plegado en modo manual (D-11); pie fijo con safe-area y relleno inferior del contenido; sin tarjeta envolvente; «Atrás» fuera del pie en la primera pregunta (D-08); aviso de precio solo en revisión; la pantalla de retirada usa el título-pregunta del schema.

**Dependencias:** F1. **Riesgos:** pie fijo + teclado virtual de iOS (el pie puede tapar el campo): probar en iOS Safari real o en el simulador; en el modal del jardinero el pie fijo **no** debe salir del modal (variante no fija por prop).
**No se modifica:** props públicas y `onSubmit` de `ManualEntryWizard`; telemetría.
**Aceptación:** en los 7 servicios a 375 px, la pregunta y su control quedan en el primer pliegue y «Siguiente» siempre está visible; el nombre del servicio se ve en cada pregunta; «Pregunta X de Y» nunca crece; el modal del jardinero sigue funcionando igual; paridad 88/88; envío del banco con 0 diferencias.
**Precio:** paridad + E2E local (mismo precio por profesional y misma huella en los 7).

## F3 — Controles del sistema

**Objetivo.** Resolver T-05, T-06, T-07, T-08, T-09, T-10, T-11, T-17, T-18, T-21 y P-03.

**Archivos:** `fields/ManualFieldRenderer.tsx` (delega), nuevos `ui/{NumberField, Stepper, OptionList, SegmentedChoice, ToggleRow, FieldError, HelpDisclosure}.tsx`, `manualEntryPresentation.ts` (control por campo), registro de iconos (+ su test).

**Cambios concretos:** sliders → `NumberField`; stepper con rejilla y caja editable; tarjetas de 2 columnas → `OptionList` de 1 columna sin salto al seleccionar; interruptor → fila entera; errores junto al campo con `aria-invalid` y foco; «Siguiente» nunca deshabilitado; referencias en «¿Cómo lo mido?»; quitar frases duplicadas; iconos coherentes (misma progresión de tamaño y de estado en los 7).

**Dependencias:** F2. **Riesgos:** parseo (P-09), corrección silenciosa (P-10, prohibida), el `step` de setos (la rejilla solo afecta a los botones; escribir sigue libre dentro del rango).
**No se modifica:** valores, rangos, `step` del schema, defaults.
**Aceptación:** ningún texto desborda su contenedor en 320, 375, 390, 430, 768 y 1280 px; todas las zonas táctiles ≥ 44 px; con los botones del stepper de setos se llega a 2,0; al teclear «2,5» se guarda 2.5; paridad 88/88; envío del banco con 0 diferencias (las acciones del banco se adaptan a los controles nuevos, **nunca los datos**).
**Precio:** paridad + E2E local + test de los ±: 0,3 → 0,5 → 1,0 → 1,5 → 2,0 (en banda `0-2m`) → 2,5 (en `2-4m`).

## F4 — Repetibles, revisión y consentimiento

**Objetivo.** Resolver T-13, T-14, T-15, P-01 y, si se aprueba D-02, P-02.

**Archivos:** `ManualEntryWizard.tsx` (descartar vacío, eliminar, editar a pregunta concreta, volver a revisión), `ManualEntrySummary.tsx` → `ui/ReviewList.tsx` + `ui/ConsentRow.tsx`, `ui/ItemList.tsx`, `strings.ts` (plurales, microcopy), `DetailsPage.tsx` **solo** en `initialWasteRemoval` (D-02).

**Cambios concretos:** lista de elementos con editar/eliminar (`ConfirmDialog`); «Atrás» descarta el recién añadido vacío; la revisión marca «Faltan datos» y bloquea «Confirmar» si un elemento está incompleto; «Cambiar» por fila; formato es-ES; booleanos por etiqueta; retirada como elección explícita (D-09); casilla de 48 px con el texto legal íntegro plegado.

**Dependencias:** F3. **Riesgos:** el borrador de un cliente a medio reservar en producción puede contener hoy un elemento vacío: al desplegar, la revisión le pedirá completarlo o eliminarlo (comportamiento correcto; anotarlo en las notas de despliegue). El modal del jardinero (`requireConsent={false}`) no debe mostrar la casilla.
**No se modifica:** constructores (el fantasma se evita en la interfaz), `legalCopy.ts`, `MANUAL_ENTRY_LEGAL_VERSION`, `recordManualDeclaration`.
**Aceptación:** el escenario del fantasma de árboles ya no produce un segundo `treeGroup`; eliminar un elemento lo quita de `manualDraft.items`; los 88 casos de paridad idénticos; la huella E2E de cada servicio igual a la línea base (con D-02, la de desbroce tras fitosanitarios cambia **a propósito**, documentado).
**Precio:** paridad + E2E; test nuevo de interfaz: añadir → atrás → confirmar produce exactamente los elementos completos.

## F5 a F11 — Una fase por servicio

Cada fase aplica el sistema a un servicio a través de su entrada en
`manualEntryPresentation.ts` (agrupación, controles, títulos, referencias, unidades,
iconos) y, si hace falta, un componente específico. **Plantilla común de cada fase:**

- **Archivos:** `manualEntryPresentation.ts` (entrada del servicio), sus tests, y el
  componente específico si aparece en la tabla. Nada más.
- **Dependencias:** F4.
- **No se modifica:** schema, validación, constructor y motor del servicio.
- **Aceptación:** recorrido real completo a 375 px y a 1280 px sin desbordes, con CTA
  visible y objetivos ≥ 44 px; todas las ramas del servicio en el banco con 0 diferencias
  de envío; paridad del servicio idéntica; E2E local con el mismo precio por profesional y
  la misma huella; revisión fiel; el usuario aprueba los textos nuevos que cambien cómo se interpreta un dato (D-12).
- **Precio:** los casos de paridad del servicio + el E2E del servicio + (si hay agrupación)
  comprobación de que se emiten los mismos `stepId` en el mismo orden.

| Fase | Servicio | Cambios concretos |
|---|---|---|
| F5 | **Setos** | Pantalla «Medidas del seto» (longitud `NumberField` + altura `Stepper` con rejilla y feedback de tramo desde `HEDGE_BAND_LABELS`); caras con dibujo simple o lista sin el icono `Square`; estado en `OptionList`; **sin referencias** (D-03): «¿Cómo lo mido?» solo con el método (suma de tramos; desde el suelo hasta lo más alto, incluidos muros); una sola frase de apoyo |
| F6 | **Árboles** | Tamaño en `OptionList` con el tramo en metros como único criterio (**sin referencias**, D-03); poda con la ayuda aclarada (nombres intactos); acceso como elección compacta; `ItemList` con «Duplicar» (D-04); cabecera «Árbol N» |
| F7 | **Palmeras** | Especie con nombre común + latín (D-10) e imagen por especie (D-06, fuente según D-13); altura en `SegmentedChoice` + aviso si se reinicia al cambiar de especie; «¿En qué estado está la palmera?»; número con `Stepper`; extras: fitosanitario «Recomendado» primero con una línea + «Por qué» plegado, pelado y acceso como `ToggleRow`, acceso oculto en el tramo más bajo (P-04) |
| F8 | **Fitosanitarios** | Tamaños con rangos en metros según D-12 (sin referencias); 4 pantallas (D-05): qué tratar → «¿Cuántos…?» con título y unidad según el tipo (m² / m / ejemplares) + tamaño o «¿supera 2 m?» → tratamiento con objetivo revelado y endoterapia (palmeras) → producto (`SegmentedChoice` + ayuda común); «Pregunta X de Y» que solo baja; unidad en la revisión |
| F9 | **Desbroce** | Superficie `NumberField` con miles (D-07) y la nota «si la conoces por la escritura o el catastro, usa esa cifra» (es una fuente del dato, no una comparación); dificultad en `OptionList`; «Opciones del servicio» (herbicida + retirada) si D-05, con el coste mencionado |
| F10 | **Césped** | Superficie `NumberField` sin referencias (D-03), «¿Cómo lo mido?» con el método (largo × ancho; suma de zonas); estado en `OptionList`; queda como patrón del sistema |
| F11 | **Arbustos** | Superficie `NumberField` sin referencias; tamaño con rangos en metros según D-12 e iconos de la misma progresión; estado en `OptionList` |

## F12 — Cohesión, accesibilidad, verificación final y paso a producción

**Objetivo.** Revisión lado a lado de los 7; accesibilidad (VoiceOver y teclado); tablet y
escritorio; modal del jardinero; batería de producción; merge y despliegue.

**Cambios:** solo correcciones de cohesión encontradas en la revisión.
**Aceptación:** §11 completo; la batería de producción de esta ronda añadida a
`docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md`; sección de acciones manuales del usuario.
**Despliegue:** solo frontend (Vercel). Ninguna Edge Function ni migración, si se respeta D-01.

---

## 9. Plan por servicio y prioridad

### 9.1 Cómo se calcula la prioridad

Cinco factores de 1 (bajo) a 3 (alto). Conversión y riesgo de error con efecto en precio
pesan doble. Sin datos de tráfico en esta sesión (el MCP de Supabase no conecta), la
conversión se estima por peso del servicio y por el porcentaje de reservas que pasan por el
manual. En la pre-fase se puede contrastar con `booking_funnel_events`
(`booking.manual_entry_started` por `serviceKey`).

| Servicio | Conversión (×2) | Dificultad actual | Complejidad | Problemas móvil | Riesgo de error con precio (×2) | **Puntos** |
|---|---|---|---|---|---|---|
| Setos | 3 | 2 | 2 | 2 | 3 (altura/tramo, caras) | **18** |
| Árboles | 2 | 2 | 2 | 3 | 3 (fantasma, referencias de tramo) | **17** |
| Palmeras | 2 | 3 (latín) | 3 | 3 | 2 (altura por especie, extras) | **17** |
| Fitosanitarios | 1 | 3 | 3 | 3 | 3 (unidad invisible) | **17** |
| Desbroce | 3 (100 % manual) | 2 | 1 | 2 | 2 (slider 1–10000, retirada heredada) | **15** |
| Césped | 3 | 2 | 1 | 2 | 1 | **13** |
| Arbustos | 2 | 2 | 1 | 2 | 1 | **11** |

Empate a 17: árboles → palmeras → fitosanitarios, por dependencia. Árboles es el
repetible más simple y valida `ItemList`; palmeras añade opciones dinámicas y extras;
fitosanitarios usa todo lo anterior (repetible, condicionales, unidad dinámica, agrupación).

### 9.2 Tabla por servicio

| Servicio | Problemas principales | Cambios UX | Cambios UI | Riesgo funcional | Prioridad |
|---|---|---|---|---|---|
| Setos | Stepper que salta el 2,0 m (tramo); sin feedback de tramo; icono de «una cara» que parece casilla; frase duplicada; slider | Medidas en una pantalla; rejilla 0,5; tramo en vivo | `NumberField`, `Stepper`, `OptionList`, dibujo de caras | Bajo si la rejilla solo afecta a ±; verificar banda 2,0 | 1 (18) |
| Árboles | Fantasma cobrado; sin eliminar; referencias incoherentes; 15 pantallas para 5 árboles iguales; tarjetas de 200-240 px | Lista con editar/eliminar/duplicar; referencias coherentes; acceso compacto | `OptionList`, `ItemList` | Medio: la lista de elementos toca el estado del asistente | 2 (17) |
| Palmeras | Latín; mismo icono ×6; altura que se reinicia sin aviso; acceso inerte en tramo bajo; «Más de 10 m» de 266 px; CTA a 350 px del pliegue | Nombre común; aviso de reinicio; ocultar lo inerte; extra recomendado destacado | `OptionList`, `SegmentedChoice`, `ToggleRow` | Bajo (P-04 ya lo ignora el constructor) | 3 (17) |
| Fitosanitarios | Cantidad sin unidad; stepper 1–5000; hasta 7 pantallas; contador que crece; pantallas de un interruptor | 4 pantallas; unidad y título por tipo; revelado condicional | `NumberField`, `OptionList`, `SegmentedChoice` | Medio: más condicionales por pantalla; emitir todos los `stepId` | 4 (17) |
| Desbroce | Slider 1–10000; retirada heredada; dos pantallas de un interruptor | Opciones juntas; miles; retirada propia | `NumberField`, `OptionList`, `ChoiceRow` | Bajo (P-02 va en F4 con D-02) | 5 (15) |
| Césped | Slider 1–5000; «Paso 2 de 2» falso; tarjetas desbordadas | Referencias plegadas | `NumberField`, `OptionList` | Muy bajo | 6 (13) |
| Arbustos | Slider 1–2000; referencias ambiguas; icono de pino | Una referencia por tramo | `NumberField`, `OptionList` | Muy bajo | 7 (11) |

---

## 11. Criterios de aceptación (globales, además de los de cada fase)

1. **Precio idéntico:** `manualEntryPricingParity.test.ts` sin actualizar snapshots (los
   88 casos iguales) en todas las fases.
2. **Envío idéntico:** el banco (`scripts/qa/manual-entry`) con 0 diferencias de `items` y
   `wasteRemoval` frente a `baseline/payloads.json` para todas las ramas de los 7 servicios.
3. **Precio real idéntico:** E2E local rama (5191) vs. `main` (5192): mismo precio por
   profesional en «Profesionales» y misma huella de la colección guardada, en los 7.
   Única excepción permitida y documentada: D-02 (si se aprueba).
4. **Corrección del jardinero:** «Recalcular precio» da el mismo importe que la línea base.
5. **Móvil (320-430 px):** pregunta, control y CTA visibles sin scroll en todas las
   pantallas de pregunta (la revisión puede hacer scroll, con CTA fijo); nada desborda;
   objetivos ≥ 44 px; ningún input < 16 px; sin saltos de maquetación al seleccionar.
6. **Accesibilidad:** foco al título al cambiar de pantalla y al primer error al fallar;
   `radiogroup`/`radio`/`switch` con nombre; `aria-invalid` y `aria-describedby` en
   errores; contraste ≥ 4,5:1 en todo el texto; recorrido completo con teclado.
7. **Sin regresiones:** `tsc` sin errores nuevos; `vitest` completo en verde; consola sin
   errores nuevos en los 7 recorridos.
8. **Nada fuera de alcance:** el diff no contiene cambios en `src/shared/manualEntry/manualEntrySchema.ts`,
   `manualEntryValidation.ts`, `legalCopy.ts`, `manualEntryBuilders.ts`,
   `bookingQuoteCore.ts`, `supabase/**` (comprobación con `git diff --stat` en la puerta).

---

## 12. Orden exacto de implementación

1. **Pre-fase** (entorno, duplicado de producción, línea base).
2. **F1** Cimientos sin cambio visible.
3. **F2** Carcasa y navegación.
4. **F3** Controles del sistema.
5. **F4** Repetibles, revisión y consentimiento (+ P-02 si D-02).
6. **F5** Setos.
7. **F6** Árboles.
8. **F7** Palmeras.
9. **F8** Fitosanitarios.
10. **F9** Desbroce.
11. **F10** Césped.
12. **F11** Arbustos.
13. **F12** Cohesión, accesibilidad, verificación final, batería de producción y despliegue.

Cada fase se commitea por separado (documentación en el mismo commit), se revisa con el
usuario al cerrar su puerta y solo entonces empieza la siguiente. F2–F4 ya resuelven la
mayor parte de los problemas en los 7 servicios; si hubiera que parar a mitad, lo
desplegable con más valor es la pre-fase + F1–F4.
