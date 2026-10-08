# F6 — Árboles · puerta de prueba

Fecha: 2026-10-01 · Rama `feat/formularios-manuales-ux-v2`.

## Qué se ha hecho

Ya venía resuelto de F2-F4 para árboles: lista de opciones de una columna, elemento fantasma,
lista con «Editar / Eliminar», cabecera «Árbol N», revisión con «Cambiar».

| Cambio | Detalle | Dónde |
|---|---|---|
| **Tamaño por tramo en metros** (D-03) | Fuera las ayudas comparativas («planta baja o puerta», «una planta de un edificio», «tejado», «requiere medios especiales»): el tramo es el único criterio. «Muy grande (> 9 m)» se enseña como «Muy grande (más de 9 m)» (el valor enviado sigue siendo `over_9`). «¿Cómo lo mido?»: «Mide la altura total: desde el suelo hasta lo más alto de la copa.» · «Si el árbol está entre dos tramos, elige el que más se aproxime. El profesional lo comprueba al llegar.» | `manualEntryPresentation.ts` (tree) |
| **Tipo de poda: ayuda del jardinero** | Nombres intactos. Ayuda nueva, la misma definición con la que el jardinero pone precio a cada tipo (`TreePruningConfigurator.tsx:259-260`): estructural «Para árboles grandes, ramas pesadas o saneamiento profundo.» · formación «Para árboles jóvenes o mantenimiento ligero.» **Pendiente de tu aprobación** (REGLAS 14) | idem |
| **Acceso compacto** | Segmentado «Acceso normal / Acceso difícil» en vez de dos tarjetas de 221 px; qué es «difícil» lo dice la frase de apoyo que ya había. Lo elegido lleva el verde de la lista de opciones (blanco sobre gris no se distinguía a 375 px) | idem, `ui/SegmentedChoice.tsx` |
| **«Duplicar»** (D-04) | En la lista de árboles, entre «Editar» y «Eliminar», solo en árboles completos. Añade una copia idéntica al final y lo anuncia: «Añadido el árbol 2, igual que el árbol 1.» (`role="status"`). Cinco árboles iguales: 3 pantallas + 4 toques en vez de 15 pantallas. Mismo contrato: N elementos, N `treeGroups`, sin `quantity` | `ui/ItemList.tsx`, `ManualEntryWizard.tsx` |
| Infraestructura | La presentación admite etiqueta y ayuda por opción (sustituir u ocultar con `null`), ayuda propia del campo y `allowDuplicate`. La revisión y la lista usan la etiqueta presentada | `presentation/`, `fields/ManualFieldRenderer.tsx` |
| Banco | Elige las opciones por la etiqueta que se enseña (no la del schema) y usa caché de Vite propia (H-N-18). Respuestas y línea base sin tocar | `scripts/qa/manual-entry/` |

No se ha tocado: schema, validación, constructor, `legalCopy.ts`, motor, `src/domain`, `supabase/`.

## Puerta

| Nivel | Resultado |
|---|---|
| A · typecheck | Los mismos 128 errores previos (mismo conjunto por archivo que `HEAD`) |
| A · vitest | 105 archivos · **795/795** (18 nuevos en `services/TreeForm.test.tsx`, incluidos los 10 recorridos de referencia de árboles por la interfaz) · 5 snapshots obsoletos de siempre (H-N-03) |
| A · paridad / alcance / lint | 88/88 · vacío · mismos 2 avisos que `HEAD` |
| B · banco | Envío = referencia (88/88) y = línea base (0 distintos), 0 desbordes, 0 CTA fuera, 0 controles < 44 px, 7/7 escenarios. Un error de consola puntual (`ERR_CONNECTION_REFUSED`, palmeras 375 px) mientras se reiniciaba el servidor de la rama; repetido palmeras + árboles: 0 errores. Repetido árboles con el código final: todo en verde |
| C · E2E anónimo 375/1280 | 14 recorridos por servidor; **todo coincide** entre `main` y la rama y con la línea base: árboles 289,13 € · 3 h · huella `de7ae9bcd74ad93b` · 10 eventos · corrección 257 € / 3 h. Desborde de la rama 0 px (los 15 px de árboles y 13 px de arbustos son de `main`, como en la línea base) |
| C · E2E con cliente sembrado | 7 servicios: precio, huella, eventos y **declaraciones** iguales |
| C · escenarios F4 | Siguen corregidos (1 árbol, 103,50 €; desbroce en «Sí») |
| D · jardinero | 45 €, sin pie fijo en el modal |

## Pruebas reales (navegador del panel, 375 × 812, rama)

Reserva real → árboles → «Escribo los datos»:
- Tamaño: cuatro tramos sin comparaciones; «¿Cómo lo mido?» se despliega con el método.
- Poda: las dos opciones con la ayuda nueva, sin desbordes.
- Acceso: segmentado; «Acceso difícil» elegido se ve en verde.
- Lista: «Duplicar» → «Árbol 2» idéntico y el aviso; «Eliminar» aparece al haber dos.
- **Recarga a mitad**: el borrador conserva los dos árboles y el acceso elegido.
- Revisión: los dos árboles con «Mediano (3-5 m) · Poda estructural · Acceso difícil» y la
  retirada; la casilla sigue obligando.

Capturas del banco a 375 px en `~/Downloads/auditorias/formularios-qa/fase-6-bench-final/screens/`.

## Hallazgos de la fase

- **H-N-17** (abierto, decisión tuya): la pregunta de acceso se puede saltar sin elegir (los
  booleanos son opcionales en el schema); la revisión enseña «—» y se cobra como acceso normal.
  Igual en `main`. Propuesta: exigir la elección solo en la interfaz.
- **H-N-18** (resuelto): caché de Vite compartida entre el banco y la rama.

## Lo que tienes que hacer tú

- **Local:** aprobar (o corregir) las dos ayudas nuevas del tipo de poda; decidir H-N-17.
- **Producción:** (nada que desplegar)
