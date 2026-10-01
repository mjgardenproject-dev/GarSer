# Progreso

| Fase | Estado | Fecha | Commit | Puerta (A/B/C/D/E) | Notas |
|---|---|---|---|---|---|
| Auditoría y plan | ✅ Aprobado (D-01…D-11 respondidas) | 2026-09-30 | 757d21c + siguiente | — | D-03 = quitar referencias; nuevas D-12 (antes de F8/F11) y D-13 (antes de F7) |
| Pre-fase | ✅ Terminada y aprobada | 2026-09-30 | 1d157f1 | A ✅ · B línea base · C ✅ · D-precio ✅ | `qa/pre-fase.md`, `qa/linea-base.md`. BD local rehecha (copia previa), licencia del jardinero en local, Playwright aislado, `e2e-local.mjs` reconstruido |
| F1 Cimientos | ✅ Terminada y aprobada | 2026-09-30 | c5704fa | A ✅ · B = línea base · C ✅ · D ✅ | `qa/fase-1.md`. Sin cambio visible ni de precio |
| F2 Carcasa y navegación | ✅ Terminada y aprobada | 2026-10-01 | 90a7308 | A ✅ · B envío = línea base · C ✅ · D ✅ (+ modal real) | `qa/fase-2.md`. CTA fuera: 242 → 1; desborde 16 → 0. Pendiente: prueba con teclado de iOS (H-N-14) |
| F3 Controles | ✅ Terminada y aprobada | 2026-10-01 | 7d1733a | A ✅ · B envío = línea base · C ✅ · D ✅ | `qa/fase-3.md`. Controles < 44 px 43 → 7 (resumen, F4); escenarios 4/7 (fantasmas en F4) |
| F4 Repetibles y revisión | ✅ Terminada y aprobada | 2026-10-01 | 5fd2af9 | A ✅ · B 100 % verde · C ✅ · D ✅ | `qa/fase-4.md`. Fantasma (P-01) y retirada heredada (P-02) corregidos y comprobados en la app real frente a `main` |
| F5 Setos | ✅ Terminada, **esperando visto bueno** | 2026-10-01 | (este commit) | A ✅ · B 100 % verde · C ✅ · D ✅ | `qa/fase-5.md`. Decisión abierta H-N-15 |
| F6 Árboles | ⏳ Pendiente | | | | |
| F7 Palmeras | ⏳ Pendiente | | | | |
| F8 Fitosanitarios | ⏳ Pendiente | | | | |
| F9 Desbroce | ⏳ Pendiente | | | | |
| F10 Césped | ⏳ Pendiente | | | | |
| F11 Arbustos | ⏳ Pendiente | | | | |
| F12 Cierre y producción | ⏳ Pendiente | | | | |

## Registro

### 2026-09-30 — Auditoría y plan
- Retiradas las rondas anteriores (ver `README.md`).
- Recorrido real de los 7 formularios a 375/768/1280 px en local; medidas por pantalla.
- Reproducidos: elemento fantasma cobrado en árboles (P-01), retirada heredada tras
  fitosanitarios (P-02), stepper de setos que salta el 2,0 m (P-03).
- Documentos creados: README, AUDITORIA, SISTEMA-UX, PLAN-IMPLEMENTACION, REGLAS,
  METODO-Y-PRUEBAS, HALLAZGOS-NUEVOS, PROGRESO.

### 2026-09-30 — Respuestas del usuario
- D-01, D-02, D-04…D-11: sí. D-03: no; quitar por completo las referencias (no son fiables).
- Consecuencias en el plan (§0.1) y decisiones nuevas D-12 (rangos de talla alineados con el
  configurador del jardinero, H-N-09) y D-13 (origen de las imágenes de palmeras).
- Siguiente: pre-fase, pendiente del «adelante» del usuario.

### 2026-09-30 — Pre-fase
- PRE-1: sin servidores ajenos en marcha.
- PRE-2: producción = `origin/main` en frontend, migraciones (139) y `booking-authority`;
  `booking-manual-declaration` desplegada con validación del 24-08 (H-N-10).
- PRE-3: worktree de referencia `~/Downloads/auditorias/formularios-main` (5192); rama en 5191.
- PRE-4: BD local desordenada (18 migraciones fuera de orden) → copia completa y `db reset`: 139/139.
- PRE-5: licencia fitosanitaria del jardinero sembrado fijada en local (H-N-12).
- PRE-6/7: claves de prueba correctas; Playwright instalado aislado (H-N-11).
- PRE-8: línea base A/B/C/D medida; `main` y rama idénticas en los 7 servicios.
- Siguiente: F1 (cimientos sin cambio visible), pendiente del visto bueno del usuario.

### 2026-09-30 — F1 Cimientos
- `decimalText.ts` compartido (tarifas del jardinero + asistente), capa de presentación,
  `screens.ts` y `formatManualValue.ts` (sin conectar hasta F4); el asistente navega por pantallas.
- Puerta: typecheck igual (128), vitest 729/729, paridad 88/88, banco idéntico, E2E y
  corrección idénticos a la línea base en los 7 servicios.
- Siguiente: F2 (carcasa y navegación), pendiente del visto bueno del usuario.

### 2026-10-01 — F2 Carcasa y navegación
- Cabecera «Servicio · Pregunta X de Y», una sola barra, selector plegado, pie fijo, sin
  tarjeta envolvente, sin «Atrás» en la primera pregunta, aviso de precio en la revisión.
- Corregido mi montaje: caché de Vite compartida entre `main` y la rama (H-N-13).
- Nuevo `scripts/qa/manual-entry/gardener-local.mjs`: modal real del jardinero (45 €).
- Puerta: envío y precio idénticos a la línea base en los 7; CTA fuera 242 → 1; desborde 16 → 0.
- Siguiente: F3 (controles), pendiente del visto bueno del usuario.

### 2026-10-01 — F3 Controles
- Campo numérico (coma, miles, sin corrección silenciosa, Intro), stepper con rejilla, lista de
  opciones de una columna sin iconos ni saltos, fila sí/no entera, errores con artículo junto al
  campo y foco, «Siguiente» siempre activo. Sin ejemplos comparativos (D-03).
- iOS: simulador arrancado con `simctl` y página vista en Safari de iOS 26; el control de la app
  Simulator lo denegó el usuario → prueba de teclado pendiente (H-N-14).
- Puerta: envío y precio idénticos a la línea base; desborde 0, CTA fuera 0, controles < 44 px 7.
- Siguiente: F4 (repetibles, revisión y consentimiento), pendiente del visto bueno del usuario.

### 2026-10-01 — F4 Repetibles, revisión y consentimiento
- Fantasma corregido en la interfaz (descartar vacío, «Faltan datos», confirmar bloqueado);
  lista con editar/eliminar; revisión con «Cambiar» por fila y valores en español; casilla de
  44 px con el texto legal intacto; retirada en dos opciones (D-09) y no heredada (D-02).
- App real: en `main` el fantasma cobra 162,00 € (dos árboles) y en la rama 103,50 € (uno).
- Banco completamente en verde por primera vez (7/7 escenarios, 0 controles < 44 px).
- Siguiente: F5 (setos), pendiente del visto bueno del usuario.

### 2026-10-01 — F5 Setos (inicio)
Ya resuelto en F2-F4 para setos: stepper con rejilla (2,0 m), coma decimal, lista de opciones sin
desbordes ni icono `Square`, «2,3 m» en la revisión. Lo que cambia en F5:
1. Pantalla «¿Cuánto mide el seto?» con longitud y altura juntas (D-05), emitiendo `length` y
   `height` en orden. «Pregunta X de 4» (antes 5).
2. Bajo la altura, el tramo de tarifa en vivo desde `HEDGE_BAND_LABELS` (sin cambiar datos).
3. Una sola frase de apoyo; el método de medida en «¿Cómo lo mido?» (sin comparaciones, D-03); fuera
   la ayuda que repetía la descripción.
4. Pictograma sencillo (vista desde arriba) para «Solo una cara» / «Las dos caras».
Infraestructura: la capa de presentación admite título, apoyo y ayuda de medida por pantalla, y
línea de contexto por campo; el conductor del E2E salta los «siguiente» que caen dentro de una
misma pantalla agrupada (las respuestas no cambian).

### 2026-10-01 — F5 Setos (cierre)
- Hecho lo previsto: medidas en una pantalla, tramo de tarifa en vivo, método de medida, dibujo de
  las caras. Precio, horas, huella y declaraciones de setos idénticos a la línea base.
- Incidencias de herramientas resueltas (H-N-16: Maps lento, eventos simultáneos).
- Decisión abierta para el usuario: H-N-15.
- Siguiente: F6 (árboles), pendiente del visto bueno.
