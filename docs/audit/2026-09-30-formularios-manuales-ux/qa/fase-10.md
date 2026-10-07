# F10 — Césped · puerta de prueba

Fecha: 2026-10-07 · Rama `feat/formularios-manuales-ux-v2`.

## Qué se ha hecho

Ya venía resuelto de F2-F4 para césped: campo numérico con miles en vez del deslizador, sin la ayuda
que repetía el título, referencias fuera (D-03), estado en lista de una columna, retirada en dos
opciones, pie fijo, revisión con «Cambiar».

| Cambio | Detalle | Dónde |
|---|---|---|
| Frase de apoyo común | «Una medida aproximada vale: el profesional la comprueba al llegar.» (la misma de setos y fitosanitarios, ya aprobada), en vez de «Introduce una superficie aproximada. No te preocupes por ser exacto al metro.» | `manualEntryPresentation.ts` (lawn; constante `APPROXIMATE` compartida) |
| «¿Cómo lo mido?» | Solo el método: «Mide el largo y el ancho de la zona de césped y multiplícalos.» · «Si hay varias zonas, calcula cada una y súmalas.» · «Si la forma es irregular, divídela en rectángulos aproximados.» | idem |
| Estado | Sin cambios de texto: las ayudas describen el césped, sin comparaciones | — |
| Patrón del sistema | Césped documentado como patrón de referencia: `SISTEMA-UX.md` §6.15 | docs |

No se ha tocado: schema, validación, constructor, motor, `supabase/`.

## Puerta

| Nivel | Resultado |
|---|---|
| A · typecheck | Los mismos 128 errores previos |
| A · vitest | 109 archivos · **888/888** (`--maxWorkers=2`; 9 en `services/LawnForm.test.tsx`, incluidos los 6 recorridos de referencia, que envían exactamente la respuesta de referencia) |
| A · paridad / alcance / lint | 88/88 · vacío · mismos 2 avisos |
| B · banco | Completo: `patch` 88/88, línea base 0 distintos (+6 previstas de F7), 0 desbordes, 0 CTA fuera, 0 controles < 44 px, 7/7 escenarios. Un recorrido de fitosanitarios falló por tiempo y hubo un aviso de React porque **edité un comentario con el banco en marcha** (Vite recargó la página): repetido fitosanitarios + césped con el código estable, todo en verde |
| C · E2E anónimo 375/1280 y con cliente sembrado | Todo coincide con `main` y la línea base. Dos cargas de `main` agotaron el tiempo (máquina lenta, H-N-21) y se repitieron: iguales. Césped: 50,63 € · 1 h · huella `e63f0fdb20453bfc` · 6 eventos · corrección 45 € / 1 h |
| C · escenarios F4 | Siguen corregidos (1 árbol, 103,50 €; desbroce en «Sí») |
| D · jardinero | 45 €, sin pie fijo |

## Pruebas reales (navegador del panel, 375 × 812, rama)

Reserva real → césped → «Escribo los datos»: «Pregunta 1 de 3», la frase de apoyo y «¿Cómo lo mido?»
desplegado con las tres líneas del método; campo con «m²» dentro y «Siguiente» fijo abajo.

Capturas del banco a 375 px en `~/Downloads/auditorias/formularios-qa/fase-10-bench/screens/lawn/`.

## Textos para tu aprobación (REGLAS 14)

- Las tres líneas de «¿Cómo lo mido?» de césped (la frase de apoyo ya estaba aprobada en F5/F8).

## Lo que tienes que hacer tú

- **Local:** aprobar (o corregir) las líneas de «¿Cómo lo mido?».
- **Producción:** (nada que desplegar)
