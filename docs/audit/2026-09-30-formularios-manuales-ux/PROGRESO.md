# Progreso

| Fase | Estado | Fecha | Commit | Puerta (A/B/C/D/E) | Notas |
|---|---|---|---|---|---|
| Auditoría y plan | ✅ Aprobado (D-01…D-11 respondidas) | 2026-09-30 | 757d21c + siguiente | — | D-03 = quitar referencias; nuevas D-12 (antes de F8/F11) y D-13 (antes de F7) |
| Pre-fase | ✅ Terminada y aprobada | 2026-09-30 | 1d157f1 | A ✅ · B línea base · C ✅ · D-precio ✅ | `qa/pre-fase.md`, `qa/linea-base.md`. BD local rehecha (copia previa), licencia del jardinero en local, Playwright aislado, `e2e-local.mjs` reconstruido |
| F1 Cimientos | ✅ Terminada y aprobada | 2026-09-30 | c5704fa | A ✅ · B = línea base · C ✅ · D ✅ | `qa/fase-1.md`. Sin cambio visible ni de precio |
| F2 Carcasa y navegación | ✅ Terminada y aprobada | 2026-10-01 | 90a7308 | A ✅ · B envío = línea base · C ✅ · D ✅ (+ modal real) | `qa/fase-2.md`. CTA fuera: 242 → 1; desborde 16 → 0. Pendiente: prueba con teclado de iOS (H-N-14) |
| F3 Controles | ✅ Terminada y aprobada | 2026-10-01 | 7d1733a | A ✅ · B envío = línea base · C ✅ · D ✅ | `qa/fase-3.md`. Controles < 44 px 43 → 7 (resumen, F4); escenarios 4/7 (fantasmas en F4) |
| F4 Repetibles y revisión | ✅ Terminada y aprobada | 2026-10-01 | 5fd2af9 | A ✅ · B 100 % verde · C ✅ · D ✅ | `qa/fase-4.md`. Fantasma (P-01) y retirada heredada (P-02) corregidos y comprobados en la app real frente a `main` |
| F5 Setos | ✅ Terminada y aprobada | 2026-10-01 | 8eacc7f | A ✅ · B 100 % verde · C ✅ · D ✅ | `qa/fase-5.md`. H-N-15 decidido: el tramo se queda visible |
| F6 Árboles | 🟡 Terminada, pendiente de aprobación | 2026-10-01 | b1362fb | A ✅ · B 100 % verde · C ✅ · D ✅ | `qa/fase-6.md`. Ayudas de poda aprobadas (2026-10-02); H-N-17 decidido: obligar a elegir el acceso (complemento antes de F8) |
| F7 Palmeras | 🟡 Terminada, pendiente de aprobación | 2026-10-01 | bf8ceb3 | A ✅ · B 0 distintos + 6 previstas (P-04) · C ✅ · D ✅ | `qa/fase-7.md`. Textos aprobados (2026-10-02). Solo queda poner las fotos de especies cuando el usuario las tenga (D-13) |
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

### 2026-10-01 — F6 Árboles (inicio)
H-N-15 decidido por el usuario: el tramo de tarifa de setos se queda visible.
Ya resuelto en F2-F4 para árboles: lista de una columna, fantasma, lista con editar/eliminar,
cabecera «Árbol N», revisión con «Cambiar». Lo que cambia en F6:
1. Tamaño: el tramo en metros como único criterio; fuera las ayudas comparativas («planta baja o
   puerta», «una planta de un edificio», «tejado») (D-03). «¿Cómo lo mido?» con el método.
2. Tipo de poda: nombres intactos; ayuda alineada con la definición del configurador del jardinero
   («Formación: árboles jóvenes o mantenimiento ligero» / «Estructural: árboles grandes, ramas
   pesadas o saneamiento profundo»). Es un texto que cambia la interpretación de un dato de precio:
   se presenta al usuario para su aprobación al cerrar la fase (REGLAS 14).
3. Acceso: elección compacta (segmentado «Acceso normal / Acceso difícil»), con la definición de
   difícil en la frase de apoyo.
4. «Duplicar» en la lista de árboles (D-04): añade una copia idéntica (mismo contrato: N elementos).
Infraestructura: la presentación admite etiqueta y ayuda por opción (sustituir u ocultar), ayuda
propia del campo, y duplicar en la lista de elementos.

### 2026-10-01 — F6 Árboles (cierre)
- Hecho lo previsto: tamaño solo por tramo en metros (+ «¿Cómo lo mido?»), ayuda del tipo de poda
  alineada con el configurador del jardinero, acceso en segmentado, «Duplicar» en la lista.
- Fuera de lo previsto, por la prueba real a 375 px: lo elegido en el segmentado lleva el verde
  de la lista de opciones (blanco sobre gris no se distinguía). Anotado en `SISTEMA-UX.md` §6.6.
- Precio, horas, huella, telemetría y declaraciones de los 7 servicios idénticos a `main` y a la
  línea base; banco 100 % en verde.
- Hallazgos: H-N-17 (acceso que se puede saltar, decisión del usuario), H-N-18 (caché del banco,
  resuelto).
- Siguiente: F7 (palmeras), pendiente del visto bueno y de D-13 (fuente de las imágenes).

### 2026-10-01 — F7 Palmeras (inicio)
D-13 respondido: fotos propias más adelante; ahora solo los huecos por especie (archivos estáticos del
frontend; sin foto, la opción se ve sin imagen). Ya resuelto en F2-F4 para palmeras: lista de una
columna sin desbordes, plurales («grupos de palmeras»), lista con editar/eliminar, fantasma. Lo que
cambia en F7:
1. Especie: nombre común como etiqueta y latín debajo (D-10), con su rasgo para reconocerla; hueco de
   foto por especie (D-06/D-13).
2. Altura del tronco: segmentado; el aviso del tramo más alto como línea bajo el control; si se
   cambia de especie y la altura elegida ya no existe, se dice («elige de nuevo la altura»).
3. Estado: «¿En qué estado está la palmera?».
4. Número: stepper sin la abreviatura «ud».
5. Extras: pregunta en vez de «Opciones adicionales»; coste dicho una vez en la frase de apoyo;
   fitosanitario primero con «Recomendado» y una línea; pelado y acceso con una línea cada uno;
   **acceso oculto en el tramo más bajo** (P-04: el constructor ya lo descarta). Consecuencia
   prevista: en las respuestas de referencia del tramo más bajo el envío deja de llevar
   `hasAccessDifficulty: true` (el `patch` es idéntico) y, en pindó y palmera real de tramo bajo, la
   pantalla de extras desaparece (no se emite su `stepId`). Se documenta como diferencia prevista en
   el banco, no se toca la línea base.
Textos para aprobar al cierre (REGLAS 14): nombres comunes, frase de coste de los extras.

### 2026-10-01 — F7 Palmeras (cierre)
- Hecho lo previsto: nombre común + latín, huecos de foto por especie (vacíos, D-13), altura en
  segmentado con su aviso, aviso al cambiar de especie, estado y número, extras con el coste dicho
  una vez y el fitosanitario «Recomendado», acceso oculto en el tramo más bajo (P-04).
- Cambio respecto al plan: el fitosanitario lleva una línea con el porqué, sin plegado (cabía).
- Diferencia prevista y acotada con la línea base: 6 respuestas del tramo más bajo (sin
  `hasAccessDifficulty`, y sin `stepId` `extras` en pindó y palmera real); `patch` idéntico. El banco
  la reconoce de forma explícita; la línea base no se toca.
- Precio, horas, huella, telemetría y declaraciones del E2E idénticos a `main` en los 7 servicios.
- Siguiente: F8 (fitosanitarios), pendiente del visto bueno; necesita tu decisión D-12 (tallas en metros como las del configurador del jardinero; pendiente).

### 2026-10-02 — Respuestas del usuario
- F7: textos aprobados (nombres comunes, frase de coste de los extras, líneas del fitosanitario y
  del acceso). Pendiente solo de las fotos (D-13).
- D-12 (fitosanitarios) respondido: rangos del jardinero en palmeras (< 3,5 / 3,5–8 / > 8 m),
  plantas (< 0,5 / 0,5–1,5 / 1,5–2 m) y setos («¿Supera los 2,5 m?»). F8 ya no tiene bloqueos.
- F6: ayudas del tipo de poda aprobadas. H-N-17: obligar a elegir el acceso del árbol, solo en
  la interfaz (se hace como complemento de F6 antes de F8).
- D-12 (arbustos, F11): rangos del jardinero 0–1 / 1–2 / 2–3 m.
- H-N-10: `booking-manual-declaration` se redespliega en F12, con aprobación.
- Ya no queda ninguna decisión abierta para F8–F12, salvo las fotos de palmeras (D-13) y la prueba
  del teclado en iPhone (H-N-14), que son acciones del usuario.

### 2026-10-02 — Complemento F6: H-N-17
- `requireChoice` en la presentación (solo interfaz): el acceso del árbol hay que elegirlo; sin
  elegir, «Elige una opción para continuar.» con el foco en el grupo, y un árbol sin él cuenta como
  incompleto. La validación compartida y el constructor no cambian.
- Nota: en el modal de corrección del jardinero, una declaración antigua sin el acceso pedirá
  elegirlo antes de recalcular (es una confirmación, no cambia el precio).
- Puerta: typecheck igual (128), vitest 828/828 (2 nuevas en `TreeForm.test.tsx`), banco de árboles
  0 distintos con la línea base. El E2E completo va en la puerta de F8.

