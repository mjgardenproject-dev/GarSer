# F2 — Carcasa y navegación · puerta de prueba

Fecha: 2026-10-01 · Rama `feat/formularios-manuales-ux-v2`.

## Qué se ha hecho

| Hallazgo | Cambio | Dónde |
|---|---|---|
| T-01 doble progreso / «Paso 2 de 2» falso | Una sola barra (la de la reserva). En el asistente, texto «Pregunta X de Y» que cuenta la retirada de restos y que nunca crece (fitosanitarios ya no pasa de 4 a 5 y a 6) | `ManualEntryWizard`, `presentation/screens.ts` |
| T-02 sin nombre del servicio | Cabecera de pregunta «Corte de césped · Pregunta 1 de 3». Con varios servicios, solo «Pregunta X de Y», porque la página ya dice «Servicio 1 de 2: …» | `ui/ManualStepHeader.tsx`, prop `showServiceName` |
| T-03 selector de ~300 px en cada pregunta | Selector plegado a una línea en modo manual: «Introduces los datos a mano · Usar fotos» (D-11). También al repetir un servicio (antes se ocultaba del todo). En modo fotos vuelve entero | `ManualEntryChoice` (`compact`), `DetailsPage` (montaje) |
| T-04 CTA fuera del pliegue | Pie fijo abajo con safe-area («Atrás» 1/3, acción principal 2/3), como el «Continuar» del modo fotos. En el modal del jardinero va en línea (prop `stickyFooter`, que solo pasa `DetailsPage`) | `ui/WizardFooter.tsx` |
| T-12 «Cambiar a fotos» de 24 px; «Atrás» muerto en la primera pregunta | «Usar fotos» de 44 px en el selector plegado; sin «Atrás» en la primera pregunta (D-08) | idem |
| T-16 aviso de precio en cada pantalla | Una vez, en la revisión, y solo para el cliente | `ManualEntryWizard` |
| T-22 tarjeta dentro de tarjeta | Sin tarjeta envolvente: el asistente es la página | `ManualEntryWizard` |
| T-20 (parte) | Fuera la barra de progreso sin nombre; el selector completo es ya un `radiogroup` con nombre; títulos de pregunta `h2` con foco | `ManualEntryWizard`, `ManualEntryChoice` |
| Retirada de restos | Usa el título-pregunta del schema («¿Quieres que retiremos los restos?») en vez de repetir la etiqueta | `ManualEntryWizard` |
| Aviso de la casilla | Encima del botón final que explica, y más corto («Marca la casilla para poder continuar.») | `WizardFooter` (`note`), `strings.ts` |
| Desborde en 320-375 px (árboles, arbustos) | El texto de las tarjetas puede encogerse y se parte **por sílabas** (`hyphens-auto`, `lang="es"`). Era necesario ya: con el pie fijo, una página más ancha que la pantalla dejaba el botón sin recibir el toque en el móvil (lo detectó el banco). Las tarjetas se rehacen en una columna en F3 | `ManualFieldRenderer` |

No se ha tocado: schema, validación, `legalCopy`, constructores, motor, `supabase/`, el envío de
`DetailsPage` ni la telemetría (mismos eventos y `stepId`). Las props públicas del asistente
siguen igual; solo hay dos opcionales nuevas (`stickyFooter`, `showServiceName`) y una en el
resumen (`showHeading`).

**Pendiente de esta fase:** T-19 (volver a la misma pregunta al recargar) se deja, como preveía el
plan («opcional»), para no meter estado de navegación en el borrador en una fase de estructura.

## Puerta

| Nivel | Resultado |
|---|---|
| A · typecheck | Los mismos 128 errores previos |
| A · vitest | 101 archivos · **738/738** (9 nuevos en `ManualEntryWizardShell.test.tsx`) · ningún snapshot escrito |
| A · paridad | 88/88 |
| A · alcance | vacío |
| B · envío (88 respuestas) | **= referencia y = línea base (0 diferencias)**, telemetría incluida |
| B · desborde | **0 pantallas** (línea base: 16) |
| B · CTA fuera de pantalla (≤ 414 × 667) | **1** (línea base: 242). La que queda es el modo jardinero, que va en línea a propósito, como su modal |
| B · controles < 44 px | 40 (línea base: 43): desaparecen «Cambiar a fotos» y los deslizadores no; los que quedan son campos, interruptores, «Editar» y la casilla (F3 y F4) |
| B · escenarios | 1/7: «Atrás» en la primera pantalla ✅. Los otros seis son de F3 y F4 |
| C · E2E anónimo 375/1280 | 14 filas de la rama = línea base (total, horas, huella, telemetría, corrección). **Desborde 0 px** en los 7 (línea base: árboles 15 px, arbustos 13 px) |
| C · E2E con cliente sembrado | 7 filas = línea base; declaraciones escritas |
| D · precio de la corrección | = línea base en los 7 |
| D · **modal real del jardinero** (`gardener-local.mjs`, nuevo) | Propone **45 €** (línea base) en `main` y en la rama; sin pie fijo dentro del modal; consola limpia |

## Pruebas reales adicionales (app en local, 375 px)

- **Reserva de dos servicios** (césped + setos): la página dice «Servicio 1 de 2: Corte de
  césped» y el asistente «Pregunta 1 de 3», sin repetir el nombre.
- **«Usar fotos» y vuelta:** vuelve el selector completo, el título «Fotos de tu césped» y el
  «Continuar» fijo de la página; al volver a «Escribo los datos», el asistente conserva los
  120 m² escritos y solo hay un pie fijo.
- Capturas de césped (pregunta, estado, retirada, revisión), del modal del jardinero y de la
  reserva de dos servicios en `~/Downloads/auditorias/formularios-qa/fase-2-*`.

## Incidencias durante la fase

- **H-N-13 (mi montaje):** `main` y la rama compartían la caché de Vite y el panel del jardinero
  caía al azar en los dos. Corregido; los resultados de la pre-fase y de F1 no se ven afectados
  (sus comparaciones dieron idénticas).
- **H-N-14:** el simulador de iOS no está disponible (Xcode sin seleccionar), así que el pie
  fijo con el teclado virtual de iOS **no se ha podido probar aquí**. Queda como acción del usuario.
- Datos de prueba locales: reserva manual `pending` de césped para el jardinero sembrado (id
  `34dd9f49-…`), necesaria para el modal; se conserva para las fases siguientes.

## Lo que tienes que hacer tú

- **Local (opcional, recomendado):** probar el pie fijo con el teclado del iPhone. O bien
  ```bash
  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
  ```
  y lo pruebo yo en el simulador, o abres la rama en tu iPhone.
- **Producción:** (nada que desplegar)
