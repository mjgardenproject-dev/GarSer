# F8 — Fitosanitarios · puerta de prueba

Fecha: 2026-10-02 · Rama `feat/formularios-manuales-ux-v2`.

Antes de F8 se cerró el complemento de F6 decidido por el usuario (H-N-17, commit `2a9fd0f`): el
acceso del árbol hay que elegirlo, solo en la interfaz.

## Qué se ha hecho

Ya venía resuelto de F2-F4: lista de una columna, cantidad con campo numérico (sin stepper de 1 a
5000), «Pregunta X de Y» que no crece, fantasma, sin retirada.

| Cambio | Detalle | Dónde |
|---|---|---|
| **De hasta 7 pantallas a 4-5** (D-05) | Qué tratar → cuánto y de qué tamaño → tipo de tratamiento (con «qué combatir» en la misma pantalla al elegir curativo) → producto → setos altos o endoterapia (solo setos y palmeras). Ninguna pregunta quitada. Césped, plantas y árboles: 4 preguntas; setos y palmeras: 5 | `manualEntryPresentation.ts` (phytosanitary) |
| **Cantidad según lo que se trata** (P-08) | Título, nombre y unidad: «¿Cuántos m² de césped hay que tratar?» · Superficie de césped (m²); «¿Qué superficie de plantas…?» (m²); «¿Cuántos metros de seto…?» · Longitud de seto (m); «¿Cuántos árboles hay que tratar?» · Número de árboles; «¿Cuántas palmeras…?». Revisión: «3 árboles», «1 palmera», «1.200 m²». Mismo dato `area` | idem, `formatManualValue.ts` (`reviewUnit`) |
| **Tamaños con los tramos del jardinero** (D-12) | Árboles: Pequeños (menos de 3 m) · Medianos (3-6 m) · Grandes (más de 6 m). Palmeras: Pequeñas (menos de 3,5 m) · Medianas (3,5-8 m) · Altas (más de 8 m), de tronco. Plantas: Pequeñas (menos de 0,5 m) · Medianas (0,5-1,5 m) · Grandes (1,5-2 m). Sin comparaciones. Los valores enviados no cambian | idem |
| **Setos altos a 2,5 m** (D-12) | «Supera los 2,5 m de altura»; apoyo «Los setos de más de 2,5 m llevan más producto y más tiempo.» (el jardinero cobra Bajos/Medios < 2,5 m · Altos 2,5-5 m) | idem |
| Producto | Segmentado «Convencional / Ecológico» con la ayuda común «El ecológico puede tener un recargo según el profesional.» | idem |
| Nombres | «Tipo de tratamiento», «Plaga o enfermedad a combatir» (antes «Intención…», «Objetivo…»); en las pantallas con dos preguntas, la segunda lleva su nombre encima (la primera la nombra el título, así nada se mueve al aparecer «qué combatir») | idem, `ui/OptionList.tsx`, `ui/SegmentedChoice.tsx` (`showLabel`) |
| Infraestructura | Presentación que depende de lo contestado: título y apoyo por pantalla (`dynamic`), nombre, nombre en errores, etiquetas y ayudas de opciones por campo (`dynamic` + `resolveFieldPresentation`), unidad de revisión (`reviewUnit`) | `presentation/`, `ManualEntrySummary.tsx`, `ManualEntryWizard.tsx` |
| Herramientas | Banco: nombres de campo y opciones tal como se enseñan. E2E: nombres de grupo/campo equivalentes entre `main` y la rama. Escenario D-02: nombre nuevo del campo | `scripts/qa/manual-entry/` |

**Desviación del plan (H-N-19, REGLAS 7):** «¿setos altos?» y la endoterapia no van junto a la
cantidad y el tratamiento, sino en una última pantalla, porque en el schema esos pasos van después
del producto y adelantarlos cambiaría el orden de la telemetría. Pendiente de tu decisión.

No se ha tocado: schema, validación, constructor (`buildPhytosanitaryZones`), motor, `supabase/`.

## Puerta

| Nivel | Resultado |
|---|---|
| A · typecheck | Los mismos 128 errores previos |
| A · vitest | 107 archivos · **864/864** (36 en `services/PhytoForm.test.tsx`, incluidos los 23 recorridos de referencia de fitosanitarios por la interfaz; 2 pruebas de estructura actualizadas a las 4-5 pantallas, mismo invariante: el total no crece) |
| A · paridad / alcance / lint | 88/88 · vacío · mismos 2 avisos |
| B · banco | `patch` = referencia 88/88; línea base **0 distintos** (fitosanitarios: envío y telemetría idénticos, el orden se conserva) + las 6 previstas de F7; 0 desbordes, 0 CTA fuera, 0 controles < 44 px, 0 errores de consola, 7/7 escenarios. 420 pantallas (6 menos por la agrupación) |
| C · E2E anónimo 375/1280 | **Todo coincide** con `main` y la línea base. Fitosanitarios (3 árboles grandes curativo hongos ecológico + 2 palmeras medianas preventivo con endoterapia): 466,88 € · 2 h · huella `25a54c8b95f0f71f` · 16 eventos · corrección 415 € / 2 h. Rama 0 px de desborde |
| C · E2E con cliente sembrado | 7 servicios iguales, declaraciones incluidas |
| C · escenarios F4 | Siguen corregidos (1 árbol, 103,50 €; desbroce en «Sí») |
| D · jardinero | 45 €, sin pie fijo (tras recrear la solicitud de prueba caducada, H-N-20) |

## Pruebas reales (navegador del panel, 375 × 812, rama)

Reserva real → fitosanitarios → «Escribo los datos»: Árboles → «¿Cuántos árboles hay que tratar?»
con el número y la altura en la misma pantalla → «¿Qué tipo de tratamiento necesitas?»: al elegir
«Curativo» aparece debajo «Plaga o enfermedad a combatir» sin mover nada de arriba → producto en
segmentado → lista («Árboles · 3 árboles · Grandes (más de 6 m)») → revisión con «3 árboles» y los
nombres nuevos.

Capturas del banco a 375 px en `~/Downloads/auditorias/formularios-qa/fase-8-bench-final/screens/phytosanitary/`.

## Textos para tu aprobación (REGLAS 14)

- Los títulos de cantidad por tipo y los nombres «Superficie de césped / de plantas», «Longitud de
  seto», «Número de árboles / de palmeras».
- «Tipo de tratamiento», «Plaga o enfermedad a combatir».
- «El ecológico puede tener un recargo según el profesional.»
- Apoyos: «Si son de varios tamaños, elige el más habitual.» (y variantes), «Mide solo el tronco,
  hasta donde empiezan las hojas.» en palmeras.

## Lo que tienes que hacer tú

- **Local:** aprobar (o corregir) los textos de arriba y decidir H-N-19 (mantener el orden —
  recomendado— o mover setos altos y endoterapia antes aceptando que cambie el orden de la
  telemetría).
- **Producción:** (nada que desplegar)
