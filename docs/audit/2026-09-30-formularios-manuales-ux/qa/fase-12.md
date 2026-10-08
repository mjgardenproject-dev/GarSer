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

## Parte de producción

Decisión del usuario (2026-10-08): subir la rama, abrir el PR y fusionarlo; desplegar todas las
funciones; probar en vivo en garser.es como cliente anónimo hasta «Profesionales» (sin reservas ni
pagos reales). La parte con sesión, el iPhone y el jardinero quedan para el usuario (Sección 21).

### Precios en producción ANTES del despliegue (`prod-prices.mjs`, solo lectura)

Mismas respuestas que el E2E local, dirección Avenida Ricardo Soriano 12, Marbella:

| Servicio | Antes |
|---|---|
| Césped | Jardines prueba28 · 56,25 € · 1 h |
| Setos, árboles, palmeras, arbustos, fitosanitarios, desbroce | El formulario llega a «Profesionales»; «No hay profesionales disponibles» en esa dirección |

### Fusión y despliegue (2026-10-08)

| Paso | Resultado |
|---|---|
| PR | [#43](https://github.com/mjgardenproject-dev/GarSer/pull/43); vista previa de Vercel en verde |
| Fusión | Squash en `main` → `2220c8a` |
| Frontend | Vercel publica `main` en producción: «Deployment has completed» |
| Funciones | `supabase functions deploy --use-api` de las 14 del repositorio. Antes se comprobó que `config.toml` declara `verify_jwt = false` para las 14 (como en producción) y que el código local era idéntico a `main`. Después: las 14 `ACTIVE` y con `verify_jwt=false` (`booking-manual-declaration` v12 → v13, H-N-10). `email-otp` solo existe en producción y no se tocó |
| Migraciones | Ninguna (la ronda no toca `supabase/`) |

### Precios en producción DESPUÉS del despliegue (`prod-prices.mjs`)

| Servicio | Antes | Después |
|---|---|---|
| Césped | Jardines prueba28 · 56,25 € · 1 h | Jardines prueba28 · 56,25 € · 1 h ✅ |
| Setos, árboles, palmeras, arbustos, fitosanitarios, desbroce | Llega a «Profesionales»: sin profesionales en esa dirección | Igual ✅ |

### Prueba en vivo en garser.es (navegador, 375 × 812, anónimo, sin reservas ni pagos)

Una reserva con los 7 servicios, recorriendo los 7 formularios nuevos hasta «Profesionales»:

- 21.1 ✅ selector en una línea, «Pregunta X de Y», frase de apoyo, «¿Cómo lo mido?».
- Desbroce ✅ «2.500» → revisión «2.500 m²»; «Opciones del servicio» con herbicida y retirada.
- Árboles ✅ sin elegir el acceso: «Elige una opción para continuar.»; «Duplicar» → «Añadido el árbol 2, igual que el árbol 1.».
- Palmeras ✅ nombres comunes; canaria 0-4 m → sin «Acceso difícil».
- Arbustos ✅ «Pequeñas (0-1 m) · Medianas (1-2 m) · Grandes (2-3 m)».
- Setos ✅ con «+»: 2 m → «Tramo de tarifa: Bajo (hasta 2 m)»; 2,5 m → «Medio (2-4 m)».
- Fitosanitarios ✅ sin ayudas redundantes; «¿Cuántos árboles hay que tratar?» con la altura; «Curativo» revela «Plaga o enfermedad a combatir»; revisión «3 árboles».
- «Profesionales» ✅ se carga (con los 7 servicios juntos no hay ningún profesional que los haga todos en esa dirección).
- Consola: solo `AuthApiError: refresh_token_not_found` al cargar, de una sesión antigua guardada en el navegador del panel; no está relacionado con los formularios (H-N-23).

Queda para el usuario (Sección 21): 21.3 (teclado del iPhone), 21.11 (declaración con sesión), 21.12
(corrección del jardinero), 21.13 (telemetría en la BD de producción).

