# F4 — Repetibles, revisión y consentimiento · puerta de prueba

Fecha: 2026-10-01 · Rama `feat/formularios-manuales-ux-v2`.

## Qué se ha hecho

| Hallazgo | Cambio | Dónde |
|---|---|---|
| **P-01** elemento fantasma | «Atrás» en la primera pregunta de un elemento que no es el único vuelve a la lista y, si el elemento está vacío (solo valores por defecto), lo descarta. Un elemento a medias no se descarta: queda en la lista y en la revisión como «Faltan datos», con «Completar», y la revisión **no deja confirmar** mientras haya uno («Completa o elimina «Árbol 2» para continuar.»). El constructor no se toca | `ManualEntryWizard`, `presentation/items.ts` |
| T-14 | Pantalla intermedia con la **lista** de lo añadido (título, resumen en una línea, «Editar»/«Completar», «Eliminar» con `ConfirmDialog`), «Atrás» y plurales correctos («2 árboles», «2 grupos de palmeras», «2 zonas de tratamiento»; antes «árbols», «palmerass»). En las preguntas, «Poda de árboles · Árbol 2 · Pregunta 1 de 4» | `ui/ItemList.tsx` |
| T-13 | **Revisión** sin tarjeta dentro de tarjeta: una sección por elemento («Árbol 1» o sin título si no es repetible), cada dato con su valor en español («1.500 m», «2,3 m», «Acceso normal», «Las dos caras») y **«Cambiar» que lleva a esa pregunta** y vuelve («Volver a la revisión»); si el cambio abre preguntas nuevas, se siguen hasta completar. «Eliminar» por elemento también aquí | `ui/ReviewList.tsx`, `ManualEntrySummary.tsx` |
| T-13 consentimiento | Casilla con zona táctil de 44 px (antes 16 px), frase entera pulsable, «Leer el texto completo» de 44 px; **texto legal íntegro sin cambios** (`legalCopy.ts` intacto) | `ui/ConsentRow.tsx` |
| T-15 / **D-09** | Retirada de restos como **elección explícita**: «Sí, que se lleven los restos» (por defecto, «Puede tener un coste adicional según el profesional.») / «No, me encargo yo». Mismo booleano, mismo valor por defecto | `ManualEntryWizard`, `strings.ts` |
| **P-02 / D-02** | La retirada ya no se hereda de `bookingData.wasteRemoval` (global): sale del borrador del propio servicio, de su reserva anterior al repetir, o del valor por defecto (sí) | `DetailsPage.tsx` (solo `initialWasteRemoval`) |
| Accesibilidad | Los botones «Cambiar», «Editar», «Eliminar» se anuncian con su dato («Cambiar estado del césped», «Eliminar árbol 1»): con texto oculto el lector leía «Cambiarestado del césped» (detectado en las pruebas) | `ReviewList`, `ItemList` |

No se ha tocado: schema, validación, `legalCopy`, `MANUAL_ENTRY_LEGAL_VERSION`, constructores, motor,
`recordManualDeclaration`, `supabase/`. En `DetailsPage`, solo `initialWasteRemoval`.

## Pruebas reales en la app (375 px), `main` frente a la rama

| Escenario | `main` (= producción) | Rama |
|---|---|---|
| Árboles: un árbol mediano, «Añadir otro árbol» + «Atrás», confirmar | Revisión con **2** árboles, se guardan **2** grupos, «Profesionales» **162,00 €** | Revisión con **1** árbol, **1** grupo, **103,50 €** |
| Fitosanitarios y después desbroce en la misma reserva: valor inicial de la retirada del desbroce | **No** (heredado de fitosanitarios) | **Sí** (valor por defecto) |

Es decir: en producción, hoy, ese recorrido cobra 58,50 € por un árbol que el cliente no ha
declarado. Capturas en `~/Downloads/auditorias/formularios-qa/fase-4-real-*`.

## Notas de despliegue

- Un cliente que esté a mitad de una reserva cuando se despliegue puede tener en su borrador un
  elemento vacío (el fantasma de antes): la revisión se lo enseñará como «Faltan datos» y le pedirá
  completarlo o eliminarlo antes de confirmar. Es el comportamiento buscado.
- Con D-02, en reservas de varios servicios donde fitosanitarios va antes que otro servicio, la
  retirada de ese otro servicio pasa a empezar en «Sí» (antes «No» heredado). Puede subir el total
  de quien no mire esa pregunta, ahora explícita: es la corrección aprobada.

## Puerta

| Nivel | Resultado |
|---|---|
| A · typecheck | Los mismos 128 errores previos |
| A · vitest | 103 archivos · **766/766** (9 nuevos en `ManualEntryItems.test.tsx`) · ningún snapshot escrito |
| A · paridad / alcance | 88/88 · vacío |
| B · envío (88 respuestas) | **= referencia y = línea base (0 diferencias)** |
| B · desborde / CTA fuera / controles < 44 px | **0 / 0 / 0** (línea base: 16 / 242 / 43) |
| B · escenarios | **7/7** (línea base: 0/7): los tres fantasmas, stepper, coma, Intro, «Atrás» inicial |
| C · E2E anónimo 375/1280 y con cliente sembrado | 21 filas de la rama = línea base; declaraciones escritas; desborde 0 px |
| C · escenarios reales F4 (`scenarios-local.mjs`, nuevo) | Fantasma: 1 árbol, 103,50 €; D-02: desbroce arranca en «Sí» |
| D · precio de la corrección / modal real | = línea base en los 7 / **45 €**, sin pie fijo en el modal |

## Lo que tienes que hacer tú

- **Local:** nada.
- **Producción:** (nada que desplegar)
