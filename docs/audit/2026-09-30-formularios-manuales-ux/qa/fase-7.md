# F7 — Palmeras · puerta de prueba

Fecha: 2026-10-01 · Rama `feat/formularios-manuales-ux-v2`.

## Qué se ha hecho

Ya venía resuelto de F2-F4 para palmeras: lista de una columna sin desbordes, plurales («grupos de
palmeras»), lista con editar/eliminar, elemento fantasma.

| Cambio | Detalle | Dónde |
|---|---|---|
| **Especie con nombre común** (D-10) | Etiqueta: Palmera canaria · Palmera datilera · Washingtonia o palmera de abanico · Pindó · Palmera de molino · Palmera real. Debajo, el latín y su rasgo («Phoenix canariensis · Copa muy densa y redondeada.»). El valor enviado sigue siendo el latino | `manualEntryPresentation.ts` (palm) |
| **Huecos de foto por especie** (D-06, D-13) | Registro `presentation/palmSpeciesPhotos.ts`, uno por especie, hoy todos vacíos (`null`): la opción se ve sin imagen. Cuando el usuario pase las fotos: copiarlas a `public/images/palmeras/` y poner la ruta en su hueco. La lista las pinta a 56 × 56 px, decorativas (`alt=""`). Una prueba comprueba que cada especie tiene hueco y que cada ruta puesta existe | `palmSpeciesPhotos.ts`, `fields/ManualFieldRenderer.tsx` |
| **Altura en segmentado** | 2-4 tramos según la especie. El aviso del tramo más alto («el precio puede ajustarse tras la visita») pasa a una línea bajo el control al elegirlo (antes hacía una tarjeta de 266 px) | idem, `ui/SegmentedChoice.tsx` (`feedback`) |
| **Aviso al cambiar de especie** | Si se vuelve atrás, se cambia la especie y la altura elegida ya no existe: «Los tramos de altura cambian con la especie: vuelve a elegir la altura del tronco.» No deja seguir sin elegirla (como antes, por la validación) | idem |
| Estado | «¿En qué estado está la palmera?» | idem |
| Número | Stepper sin «ud»; la revisión dice «3» | idem |
| **Extras** | «¿Necesitas algo más?» con el coste dicho una vez: «Cada opción puede tener un coste adicional según el profesional.» Fitosanitario primero, activado (P-13), con insignia «Recomendado» y una línea: «Protege los cortes de la poda frente a plagas como el picudo rojo.» Pelado: «Acabado estético del tronco.» Acceso: «Cerca de cables, en pendiente o con obstáculos importantes.» | idem, `ui/ToggleRow.tsx` (`badge`) |
| **P-04: acceso oculto en el tramo más bajo** | Con la misma regla de dominio que usa el constructor (`isLowestRangeThresholdForSpecies`), que ahí ya lo descartaba. En pindó y palmera real de tramo bajo no queda ningún extra y la pantalla desaparece (5 preguntas en vez de 6) | `presentation/screens.ts` (`hiddenWhen`) |
| Herramientas | Banco: no pulsa campos ocultos y reconoce la diferencia prevista de P-04 (ver abajo). E2E: acepta nombres equivalentes de una opción («Phoenix canariensis» en `main`, «Palmera canaria» en la rama) | `scripts/qa/manual-entry/` |

Cambio respecto al plan: el fitosanitario lleva **una línea** que ya dice el porqué, en vez de una
línea más «Por qué» plegado. Lo que iba en el plegado cabía en esa línea, así que el desplegable
habría sido otro toque para leer lo mismo.

No se ha tocado: schema, validación, constructor, `speciesBusinessRules.ts` (solo se lee), motor,
`supabase/`. Ningún almacenamiento de Supabase para las fotos: van como archivos estáticos del
frontend.

## Diferencia prevista con la línea base (P-04)

En las 6 respuestas de referencia del tramo más bajo (una por especie), la referencia declara
«acceso difícil» a propósito para comprobar que el constructor lo descarta. La interfaz ya no lo
pregunta ahí, así que lo enviado ya no lleva `hasAccessDifficulty: true` y, en pindó y palmera
real, falta el `stepId` `extras`. El **`patch` (lo que llega al motor) es idéntico** en las 6, y
el banco solo las acepta si, quitando esas claves de la línea base, lo enviado coincide exactamente.
La línea base no se ha tocado.

## Puerta

| Nivel | Resultado |
|---|---|
| A · typecheck | Los mismos 128 errores previos (mismo conjunto por archivo) |
| A · vitest | 106 archivos · **826/826** (30 nuevos en `services/PalmForm.test.tsx`, incluidos los 21 recorridos de referencia de palmeras por la interfaz; 1 nuevo en `presentation.test.ts`: lo único oculto es el acceso de palmeras en el tramo bajo y no cambia el `patch`) |
| A · paridad / alcance / lint | 88/88 · vacío (incluido `src/domain`) · mismos 2 avisos |
| B · banco | `patch` = referencia 88/88; línea base **0 distintos** + 6 diferencias previstas (P-04); 0 desbordes, 0 CTA fuera, 0 controles < 44 px, 0 errores de consola, 7/7 escenarios |
| C · E2E anónimo 375/1280 | **Todo coincide** entre `main` y la rama y con la línea base. Palmeras (dos grupos, 4-10 m y 4-12 m con acceso difícil): 411,75 € · 5 h · huella `1b166be31abf721f` · 14 eventos · corrección 366 € / 4,5 h. Desborde de la rama 0 px |
| C · E2E con cliente sembrado | 7 servicios iguales, declaraciones incluidas |
| C · escenarios F4 | Siguen corregidos (1 árbol, 103,50 €; desbroce en «Sí») |
| D · jardinero | 45 €, sin pie fijo en el modal |

## Pruebas reales (navegador del panel, 375 × 812, rama)

Reserva real → palmeras → «Escribo los datos»:
- Especie: nombres comunes con el latín debajo, sin imágenes (huecos vacíos) y sin desbordes.
- Altura: segmentado «0-4 m / 4-10 m / Más de 10 m»; al elegir el más alto aparece el aviso.
- Palmera canaria 0-4 m → extras sin «Acceso difícil» (P-04).
- Atrás hasta la especie → «Palmera de molino» → en la altura aparece el aviso de tramos distintos
  y nada marcado; 3-6 m → extras con fitosanitario y acceso (sin pelado: esa especie no lo tiene).
- Revisión: «Palmera de molino · 3-6 m · Normal · 3 · Sí · No» y la retirada.

Capturas del banco a 375 px en `~/Downloads/auditorias/formularios-qa/fase-7-bench/screens/palm/`.

## Textos para tu aprobación (REGLAS 14)

- Nombres comunes de las seis especies (arriba).
- «Cada opción puede tener un coste adicional según el profesional.» (frase de los extras).
- La línea del fitosanitario y la del acceso difícil.

## Lo que tienes que hacer tú

- **Local:** aprobar (o corregir) los textos de arriba. Cuando tengas las fotos de las especies,
  pásamelas y las coloco en su hueco.
- **Producción:** (nada que desplegar)
