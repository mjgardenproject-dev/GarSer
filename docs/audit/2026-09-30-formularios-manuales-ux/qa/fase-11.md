# F11 — Plantas y arbustos · puerta de prueba

Fecha: 2026-10-08 · Rama `feat/formularios-manuales-ux-v2`.

## Qué se ha hecho

Ya venía resuelto de F2-F4: campo numérico con miles en vez del deslizador, referencias fuera (D-03),
listas de una columna, retirada en dos opciones.

| Cambio | Detalle | Dónde |
|---|---|---|
| Superficie (patrón de césped) | Frase de apoyo común («Una medida aproximada vale: el profesional la comprueba al llegar.») y «¿Cómo lo mido?»: «Mide el largo y el ancho del macizo y multiplícalos.» · «Si hay varios macizos, calcula cada uno y súmalos.» · «Cuenta solo la superficie con plantas, sin caminos ni césped.» | `manualEntryPresentation.ts` (shrub) |
| **Tamaño con los tramos del jardinero** (D-12) | Pequeñas (0-1 m) · Medianas (1-2 m) · Grandes (2-3 m), como el configurador (etiqueta del grande elegida por el usuario el 2026-10-08). Fuera «rodilla», «cintura o pecho», «cabeza». Apoyo: «Elige la altura de las plantas que más abundan.» Lo enviado no cambia (`pequeñas`/`medianas`/`grandes`) | idem |
| Estado | Sin cambios de texto: las ayudas describen las plantas | — |

No se ha tocado: schema, validación, constructor, motor, `supabase/`.

## Puerta

| Nivel | Resultado |
|---|---|
| A · typecheck | Los mismos 128 errores previos |
| A · vitest | 110 archivos · **903/903** (`--maxWorkers=2`; 15 en `services/ShrubForm.test.tsx`, incluidos los 11 recorridos de referencia, que envían exactamente la respuesta de referencia) |
| A · paridad / alcance / lint | 88/88 · vacío · mismos 2 avisos |
| B · banco | `patch` 88/88, línea base 0 distintos (+6 previstas de F7), 0 desbordes, 0 CTA fuera, 0 controles < 44 px, 0 errores de consola, 7/7 escenarios |
| C · E2E anónimo 375/1280 y con cliente sembrado | Todo coincide con `main` y la línea base (una carga de la rama agotó el tiempo por la lentitud de la máquina; repetida, igual). Arbustos: 303,75 € · 6 h · huella `46d29df39c1525db` · 7 eventos · corrección 270 € / 5,5 h. Desborde de la rama 0 px (los 13 px son de `main`) |
| C · escenarios F4 | Siguen corregidos |
| D · jardinero | 45 €, sin pie fijo |

## Pruebas reales (navegador del panel, 375 × 812, rama)

Reserva real → plantas y arbustos → «Escribo los datos»: 30 m² con Intro → «¿De qué tamaño son las
plantas predominantes?» con «Pequeñas (0-1 m) · Medianas (1-2 m) · Grandes (2-3 m)», sin desbordes,
«Pregunta 2 de 4».

Capturas del banco a 375 px en `~/Downloads/auditorias/formularios-qa/fase-11-bench/screens/shrub/`.

## Textos para tu aprobación (REGLAS 14)

- Las tres líneas de «¿Cómo lo mido?» de arbustos.
- «Elige la altura de las plantas que más abundan.»

## Lo que tienes que hacer tú

- **Local:** aprobar (o corregir) los textos de arriba.
- **Producción:** (nada que desplegar)
