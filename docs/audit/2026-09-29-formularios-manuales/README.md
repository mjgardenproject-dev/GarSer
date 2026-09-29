# Rediseño UX/UI de los formularios manuales de la reserva (2026-09-29)

**Alcance**: los 7 formularios de introducción manual de la página «Detalles» (paso 3 de la
reserva): césped, setos, árboles, palmeras, plantas y arbustos, fitosanitarios y desbroce.

**Regla que no se rompe en ninguna fase**: no cambian los datos que se envían, su
significado, los rangos, los valores de las opciones, los builders, la validación, el motor
de precios, las Edge Functions ni Supabase. La única excepción aprobada es **D1** (cantidad
de árboles), que se hace aislada y con su propia verificación de precio.

## Documentos de esta ronda

| Documento | Para qué sirve |
|---|---|
| [`PLAN-IMPLEMENTACION.md`](PLAN-IMPLEMENTACION.md) | Fases, archivos, riesgos, criterios de aceptación y la **puerta de prueba local** que cierra cada fase. |
| [`PROGRESO.md`](PROGRESO.md) | Estado de cada fase y paso, commits, resultados de las pruebas y aprobaciones. Se actualiza en cada commit. |
| [`HALLAZGOS-NUEVOS.md`](HALLAZGOS-NUEVOS.md) | Todo lo que se descubra durante la implementación y no estuviera en la auditoría. |
| [`CONTEXTO-NUEVA-SESION.md`](CONTEXTO-NUEVA-SESION.md) | Lo que una sesión nueva debe saber para continuar y no está en los demás documentos. |
| [`qa/`](qa/) | Informes del banco de pruebas de cada fase (la línea base es `fase-0-linea-base.md`). |
| Informe de auditoría | Página privada: https://claude.ai/artifact/A6vZDrhMBZn23pvbaS3yTc (diagnóstico completo, capturas, sistema UX, fuentes). |

## Código auditado

- `origin/main @ 999a811` (PR #41). La rama de trabajo `claude/elegant-keller-8drvlu` parte de ese
  mismo commit. Las ramas `fix/prueba-real-r01-r08` y `fix/pre-produccion` no tocan estos
  formularios.
- No se pudo abrir garser.es desde el entorno de la auditoría (el proxy bloquea el dominio),
  así que el valor de `VITE_ENABLE_MANUAL_BOOKING_INPUT` en Vercel queda pendiente de
  confirmar (D8).

## Hallazgos de la auditoría (referencia para PROGRESO y commits)

Identificadores usados en el resto de documentos. El detalle y las capturas están en el
informe.

### Comunes a todos los formularios

| ID | Severidad | Hallazgo |
|---|---|---|
| V1 | Crítico | Tarjetas de opción a 2 columnas que desbordan y recortan texto (árboles 402 px y arbustos 401 px de contenido en un viewport de 375 px). |
| V2 | Crítico | `<input type="number">`: no acepta la coma decimal, `inputMode` inadecuado, la rueda del ratón cambia el valor. |
| V3 | Alto | No se ve el servicio en modo manual; hay dos barras de progreso; el total de pasos cambia a mitad del recorrido. |
| V4 | Alto | Selector de modo de ~190 px en cada paso; el CTA no es fijo (sí lo es en modo fotos). |
| V5 | Alto | Validación solo al pulsar «Siguiente»; el botón se deshabilita; error lejos del campo; «Atrás» inerte en el primer paso; Intro no avanza. |
| V6 | Alto | Sliders lineales de 1–5.000 y 1–10.000 m² (16–33 m² por píxel). |
| V7 | Medio | Exceso de tarjetas, bordes, sombras y anillos. |
| V8 | Medio | Textos repetidos (descripción = ayuda; pista de precio en cada paso; «Retirada de restos» duplicado). |
| V9 | Medio | Contraste insuficiente (`text-gray-400`), insignia de 10 px, casilla de 16 px. |
| V10 | Medio | «Editar» obliga a rehacer todos los pasos; al volver desde profesionales se empieza de cero; no se puede eliminar un elemento. |
| V11 | Medio | Grupos de radio sin navegación con flechas. |
| V12 | Medio | «Nota para el jardinero» oculta en modo manual. |

### Específicos de un servicio

| ID | Servicio | Severidad | Hallazgo |
|---|---|---|---|
| S-SET-1 | Setos | Crítico | El stepper de altura sube 0,8 → 1,3 → 1,8 → 2,3 m y nunca cae en 2,0 m, el límite del tramo de tarifa. |
| S-ARB-1 | Árboles | Crítico | Árbol fantasma: «Añadir otro» + «Atrás» deja un árbol vacío que se cobra como pequeño con poda estructural. |
| S-PAL-1 | Palmeras | Crítico | Grupo fantasma que bloquea el envío y no se puede borrar. |
| S-FIT-1 | Fitosanitarios | Crítico | Zona fantasma que bloquea el envío; mensaje de error en minúscula. |
| S-FIT-2 | Fitosanitarios | Alto | «Cantidad a tratar» sin unidad y con stepper de ±1 hasta 5.000. |
| S-FIT-3 | Fitosanitarios | Medio | Icono `TreePalm` sin registrar; el test del registro no lo detecta. |
| S-PAL-2 | Palmeras | Alto | «Acceso difícil» visible y resumido como «Sí» en el tramo más bajo, donde el builder lo descarta. |
| S-PAL-3 | Palmeras | Medio | Nombre científico como etiqueta principal. |
| S-REP-1 | Árboles, palmeras, fito | Medio | Plural roto: «2 árbols», «2 grupo de palmerass», «zona de tratamientos». |
| S-DES-1 | Desbroce | Alto | Sin nombre del servicio ni encabezado; pantalla completa para un único interruptor. |

## Decisiones del usuario (2026-09-29)

| # | Decisión | Respuesta |
|---|---|---|
| D1 | Añadir «número de árboles idénticos» al formulario manual | **Sí** |
| D2 | Mostrar «Nota para el jardinero» en modo manual | **Sí** |
| D3 | Ayudas que calculan el número (largo × ancho, pasos × 0,8), con redondeo hacia arriba al entero; sin chips de valores rápidos | **Sí** |
| D4 | Retirada de restos en la pantalla de características (y editable en el resumen) | **Sí** |
| D5 | Al volver desde profesionales con el borrador completo, abrir en el resumen | **Sí** |
| D6 | Ocultar «Acceso difícil» de palmera en el tramo de altura más bajo | **Sí** |
| D7 | Palmeras: nombre común como etiqueta principal | **Sí** |
| D8 | Valor real de `VITE_ENABLE_MANUAL_BOOKING_INPUT` en Vercel | **Pendiente**: falta el valor (`true` o `false`). |
