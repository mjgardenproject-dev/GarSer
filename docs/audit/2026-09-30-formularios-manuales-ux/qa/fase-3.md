# F3 — Controles del sistema · puerta de prueba

Fecha: 2026-10-01 · Rama `feat/formularios-manuales-ux-v2`.

## Qué se ha hecho

| Hallazgo | Cambio | Dónde |
|---|---|---|
| T-08, T-09, P-15 | Fuera los deslizadores y el `type="number"`. **Campo numérico** de texto con teclado numérico, caja visible de 56 px, unidad dentro y lectura compartida (`readManualNumber`): coma o punto decimal («1,5» = 1,5, ya no 15), miles con punto en cantidades («1.000» = 1000, D-07) con la lectura en pantalla («Se leerá como 1.000 m².»); lo que no es un número claro se marca, nunca se adivina | `ui/NumberField.tsx` |
| P-10 | Nunca se corrige un valor en silencio: fuera de rango se avisa y el valor escrito se queda | idem |
| T-10, P-03 | **Stepper** con botones de 48 px que van a la rejilla del paso (setos: 0,3 → 0,5 → 1,0 → 1,5 → **2,0** → 2,5), casilla central escribible y sin retraso al pulsar | `ui/Stepper.tsx`, `presentation/numberStep.ts` |
| T-10 | La cantidad de fitosanitarios (1–5000) pasa de stepper a campo numérico | `manualEntryPresentation.ts` |
| T-05, T-06 | **Lista de opciones en una columna**: filas de 56 px, etiqueta, una línea de ayuda y radio con hueco fijo (al seleccionar no aparece nada nuevo ni se recoloca); flechas del teclado como un grupo de radios; sin `hover` pegajoso en táctil | `ui/OptionList.tsx` |
| T-11 | **Fila sí/no entera pulsable** (antes, solo el interruptor de 48 × 28 px) | `ui/ToggleRow.tsx` |
| T-07 | **Errores** debajo del campo con `aria-invalid` y `aria-describedby`; al salir del campo y al pulsar «Siguiente»; foco al primer campo con error, centrado; «Siguiente» ya no se desactiva | `ui/FieldError.tsx`, `ManualEntryWizard.tsx` |
| T-07, T-21 | Mensajes con artículo, unidad y miles en español: «Indica la superficie de césped.», «La superficie a desbrozar no puede pasar de 10.000 m².», «Elige una opción para continuar.» | `presentation/fieldErrors.ts` |
| P-16 | Intro en una pantalla de un solo campo = «Siguiente» | `NumberField`, `ManualEntryWizard` |
| T-18 | Sin la ayuda que repetía la frase de apoyo (césped, longitud del seto) | `manualEntryPresentation.ts` (`hideHelp`) |
| D-03 | Fuera los ejemplos comparativos del schema (plaza de garaje, pádel, coche, «cada paso», puerta, cama, parcela urbana). Las comparaciones que viven en las ayudas de las opciones (tamaño de árbol, de arbusto…) se quitan en la fase de cada servicio | `ManualFieldRenderer` |
| T-17 | La lista de opciones **no pinta iconos**: no distinguían nada (el mismo brote era «césped», «normal» y «pequeño»). El registro se conserva para pictogramas con sentido en las fases de servicio | `ManualFieldRenderer` |
| Nuevos (para F5-F11) | `SegmentedChoice` (2-4 opciones cortas) y `HelpDisclosure` («¿Cómo lo mido?», solo método) listos; ningún servicio los usa aún | `ui/` |

**Desviaciones del plan, justificadas:** el plan decía «referencias en ¿Cómo lo mido?» e «iconos
coherentes»; D-03 (quitar referencias) y la medición (los iconos no discriminaban) llevan a quitar
ambos. Los objetivos táctiles de «Editar», la casilla y «Leer el texto completo» son del resumen y
van en F4.

No se ha tocado: schema, validación, `legalCopy`, constructores, motor, `supabase/`, `DetailsPage`.
Lo que se guarda en cada campo es la misma clave con el mismo número o el mismo valor de opción.

## Puerta

| Nivel | Resultado |
|---|---|
| A · typecheck | Los mismos 128 errores previos |
| A · vitest | 102 archivos · **757/757** (19 nuevos en `ManualEntryControls.test.tsx`; 1 prueba ajustada al mensaje nuevo, que además comprueba que el valor no se corrige solo) |
| A · paridad / alcance | 88/88 · vacío |
| B · envío (88 respuestas) | **= referencia y = línea base (0 diferencias)** |
| B · desborde / CTA fuera | **0 / 0** (línea base: 16 / 242) |
| B · controles < 44 px | **7** (línea base: 43): solo «Editar», la casilla y «Leer el texto completo» del resumen (F4) |
| B · escenarios | **4/7**: stepper de setos ✅ (0,5 → 1 → 1,5 → 2), coma ✅, Intro ✅, «Atrás» inicial ✅. Los tres fantasmas son de F4 |
| C · E2E anónimo 375/1280 y con cliente sembrado | 21 filas de la rama = línea base (total, horas, huella, telemetría, corrección); declaraciones escritas; **desborde 0 px** en la rama (en `main` siguen 13 y 15 px) |
| D · precio de la corrección | = línea base en los 7 |
| D · modal real del jardinero | Propone **45 €**; sin pie fijo en el modal; consola limpia |

Incidencia durante la puerta: la primera pasada del banco detectó que, tras cada «+», la casilla
del stepper enseñaba un instante el valor anterior (se sincronizaba con un efecto). Corregido
calculando el texto en el mismo render; la puerta se repitió entera sobre el código final.

## Pruebas reales adicionales

- Capturas de los 7 formularios en la app real (`~/Downloads/auditorias/formularios-qa/fase-3-ensayo/`):
  en árboles las cuatro opciones de tamaño y «Siguiente» caben ya en la primera pantalla.
- iOS: estructura vista en Safari de iOS 26 (simulador); la prueba con teclado sigue pendiente (H-N-14).

## Lo que tienes que hacer tú

- **Local:** nada.
- **Producción:** (nada que desplegar)
