# F9 — Desbroce · puerta de prueba

Fecha: 2026-10-07 · Rama `feat/formularios-manuales-ux-v2`.

Antes de empezar se comprobó el entorno tras 4 días parado (ver PROGRESO, «Reanudación»): todo en
orden salvo la memoria de la máquina (H-N-21).

## Qué se ha hecho

Ya venía resuelto de F2-F4: campo numérico en vez del deslizador de 1-10.000 m², miles con punto
(«2.500» = 2.500 m², D-07), dificultad en lista de una columna, retirada en dos opciones y sin
heredarse de otro servicio (D-02, D-09).

| Cambio | Detalle | Dónde |
|---|---|---|
| Superficie | Apoyo: «Si la conoces por la escritura o el catastro, usa esa cifra.» (fuente del dato, no comparación, D-03). Revisión «2.500 m²» | `manualEntryPresentation.ts` (weeding) |
| Dificultad | Sin cambios: las ayudas concretas (altura de maleza, zarzas, escombros) se mantienen | — |
| **«Opciones del servicio»** (D-05) | Herbicida (interruptor, apagado; «Se aplica sobre toda la superficie desbrozada.») y retirada (dos opciones, con su nombre encima) en una sola pantalla, con el coste dicho una vez: «Cada opción puede tener un coste adicional según el profesional.» El botón lleva directo a «Revisar mis datos». Desbroce pasa de 4 a **3 preguntas** | idem (`wasteOnScreen`), `ManualEntryWizard.tsx` |
| Revisión | «Cambiar retirada de restos» lleva a «Opciones del servicio» y vuelve; «Atrás» desde la revisión, también | `ManualEntryWizard.tsx` |
| Herramientas | Banco: reconoce la pantalla de opciones (antes la tomaba por la de retirada y no marcaba el herbicida) y marca allí la retirada. E2E: telemetría aislada por recorrido (H-N-22); la retirada se busca también como dos opciones. Escenario D-02: sin el «Siguiente» de la pantalla que ya no existe | `scripts/qa/manual-entry/` |

Telemetría: `area`, `state`, `herbicide` igual que antes (la retirada nunca emitió `stepId`).
No se ha tocado: schema, validación, constructor (`buildWeedingZones`), motor, `supabase/`.

## Puerta

| Nivel | Resultado |
|---|---|
| A · typecheck | Los mismos 128 errores previos |
| A · vitest | 108 archivos · **879/879** con `--maxWorkers=2` (15 en `services/WeedingForm.test.tsx`, incluidos los 8 recorridos de referencia; 2 pruebas antiguas de desbroce ajustadas a la pantalla de opciones). Con todos los procesos a la vez la máquina se saturaba (H-N-21) |
| A · paridad / alcance / lint | 88/88 · vacío · mismos 2 avisos |
| B · banco | `patch` = referencia 88/88; línea base **0 distintos** (+ las 6 previstas de F7); 0 desbordes, 0 CTA fuera, 0 controles < 44 px, 0 errores de consola, 7/7 escenarios. 414 pantallas (6 menos: la de retirada de desbroce) |
| C · E2E anónimo 375/1280 | Precio, horas y huella iguales en los 7. En la primera pasada, dos cargas de `main` agotaron el tiempo y la telemetría de la rama a 375 px recogió eventos tardíos de `main` (H-N-22, herramienta). Repetido con la telemetría aislada: **todo coincide**. Desbroce: 202,50 € · 5 h · huella `14e82f122e83f7f4` · 5 eventos · corrección 180 € / 4,5 h |
| C · E2E con cliente sembrado | 7 servicios iguales, declaraciones incluidas |
| C · escenarios F4 | Siguen corregidos (1 árbol, 103,50 €; desbroce en «Sí» tras fitosanitarios) |
| D · jardinero | 45 €, sin pie fijo (solicitud de prueba recreada: caduca, H-N-20) |

## Pruebas reales (navegador del panel, 375 × 812, rama)

Reserva real → desbroce: «2.500» → «Se leerá como 2.500 m².» → dificultad media → «Opciones del
servicio» con herbicida apagado y retirada en «Sí» → revisión «2.500 m²» → «Cambiar retirada de
restos» → «No, me encargo yo» → «Volver a la revisión» con el valor nuevo.

Capturas del banco a 375 px en `~/Downloads/auditorias/formularios-qa/fase-9-bench/screens/weeding/`.

## Textos para tu aprobación (REGLAS 14)

- «Si la conoces por la escritura o el catastro, usa esa cifra.»
- «Opciones del servicio» + «Cada opción puede tener un coste adicional según el profesional.»
- Herbicida: «Se aplica sobre toda la superficie desbrozada.»

## Lo que tienes que hacer tú

- **Local:** aprobar (o corregir) los textos de arriba. Opcional, cuando puedas: reiniciar el Mac (o al
  menos Docker) y cerrar sesiones de Claude que no uses (H-N-21).
- **Producción:** (nada que desplegar)
