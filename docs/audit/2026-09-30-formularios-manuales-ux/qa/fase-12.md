# F12 — Cierre: cohesión, accesibilidad, pago de prueba y producción

Fecha: 2026-10-08 · Rama `feat/formularios-manuales-ux-v2`.

## Parte local (hecha)

### Cohesión (los 7 lado a lado)

Hojas comparativas de las capturas del banco a 375 px (primera pregunta, error, clasificación,
última pregunta, revisión). Los 7 comparten estructura (cabecera «Servicio · Pregunta X de Y», título
como pregunta, una frase de apoyo, control, «¿Cómo lo mido?» plegado, pie fijo), errores, listas y
revisión. Una corrección, aprobada por el usuario:

| Cambio | Dónde |
|---|---|
| Fitosanitarios, «¿Qué quieres tratar?»: fuera las cuatro ayudas que repetían el nombre («Setos lineales a tratar.»…); queda «Plantas y arbustos — Macizos de plantas bajas y arbustos.» | `manualEntryPresentation.ts` (`affectedType.optionHelp`), prueba en `PhytoForm.test.tsx` |

### Accesibilidad (`scripts/qa/manual-entry/a11y.mjs`)

| Comprobación | Resultado |
|---|---|
| Autocomprobación del auditor (texto gris claro y botón sin nombre inyectados) | ✅ los detecta |
| Foco al título al cambiar de pantalla y al primer campo con error al fallar | ✅ 7 servicios + modal del jardinero |
| Nombres de `radiogroup`, `radio`, `switch`, casilla y campos | ✅ |
| `aria-invalid` + `aria-describedby` a un texto existente | ✅ |
| Contraste ≥ 4,5:1 (≥ 3:1 texto grande), salvo controles desactivados | ✅ 0 incumplimientos en 42 pantallas |
| Recorrido completo solo con teclado: césped | ✅ envía `{80 m², descuidado}` sin retirada |
| Recorrido completo solo con teclado: dos árboles con «Añadir otro» y segmentado | ✅ envía los dos árboles |

Pendiente (no automatizable aquí): VoiceOver real en iPhone (21.3 de la batería de producción).

### Tablet y escritorio

Fitosanitarios (pantalla con dos preguntas) en la app real a 768 × 1024 y en escritorio: columna
centrada, pie fijo alineado, sin desbordes. El banco ya mide 768 y 1280 px en los 7 (0 desbordes,
0 CTA fuera).

### Nivel E · Pago de prueba en local (autorizado por el usuario el 2026-10-08)

`scripts/qa/manual-entry/payment-local.mjs`: cliente sembrado, Stripe en modo test (`livemode: false`),
tarjeta pública de prueba.

| Reserva | «Profesionales» muestra | Botón | Stripe (PaymentIntent) | Reserva creada |
|---|---|---|---|---|
| Césped 80 m² descuidado, con retirada | Total 50,63 € · pagas hoy 5,63 € · 45,00 € al profesional | «Pagar 5,63 €» | 563 céntimos, `requires_capture`, captura manual | `pending`, manual, `total_price` 45,00 + `management_fee` 5,63 |
| Dos árboles (mediano estructural normal + grande formación difícil) | Total 289,13 € · pagas hoy 32,13 € · 257,00 € al profesional | «Pagar 32,13 €» | 3213 céntimos, `requires_capture` | `pending`, manual, 257,00 + 32,13 |

**Importe cobrado = importe mostrado** en los dos, y los totales son los de la línea base y del E2E.
Las dos reservas quedan en la BD local (20 y 26 de octubre, jardinero sembrado).

### Batería de producción

Añadida como **Sección 21** de `docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md` (21.1-21.13), con la
captura previa de precios (21.2, bloqueante) y la fila en el «Criterio de GO definitivo».

### Puerta tras el cambio de cohesión

Typecheck: los 128 previos · vitest 110 archivos / 904 · alcance vacío · lint 2 avisos de siempre ·
banco de fitosanitarios 23/23 y 0 distintos.

## Parte de producción (pendiente de aclaración del usuario)

El usuario pidió desplegar todo y probar en vivo en garser.es, y a la vez «todavía no» a subir la rama
y abrir el PR. El frontend solo se publica fusionando en `main` (Vercel), así que se le pregunta antes
de subir nada.
