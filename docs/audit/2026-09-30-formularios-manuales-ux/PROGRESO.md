# Progreso

| Fase | Estado | Fecha | Commit | Puerta (A/B/C/D/E) | Notas |
|---|---|---|---|---|---|
| Auditoría y plan | ✅ Aprobado (D-01…D-11 respondidas) | 2026-09-30 | 757d21c + siguiente | — | D-03 = quitar referencias; nuevas D-12 (antes de F8/F11) y D-13 (antes de F7) |
| Pre-fase | ✅ Terminada, **esperando visto bueno** | 2026-09-30 | (este commit) | A ✅ · B línea base · C ✅ · D-precio ✅ | `qa/pre-fase.md`, `qa/linea-base.md`. BD local rehecha (copia previa), licencia del jardinero en local, Playwright aislado, `e2e-local.mjs` reconstruido |
| F1 Cimientos | ⏳ Pendiente | | | | |
| F2 Carcasa y navegación | ⏳ Pendiente | | | | |
| F3 Controles | ⏳ Pendiente | | | | |
| F4 Repetibles y revisión | ⏳ Pendiente | | | | |
| F5 Setos | ⏳ Pendiente | | | | |
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
