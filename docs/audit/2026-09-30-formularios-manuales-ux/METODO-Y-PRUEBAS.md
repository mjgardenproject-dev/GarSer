# Método de actuación seguro y pruebas

## 1. Ciclo de cada fase

1. **Arranque:** leer `REGLAS.md` y `PROGRESO.md`; `git status` limpio; rama
   `feat/formularios-manuales-ux-v2`; Supabase local levantado; servidores 5191 (rama) y
   5192 (`main` de referencia) en marcha.
2. **Antes de tocar nada:** releer los archivos de la fase y apuntar en `PROGRESO.md`
   qué se va a cambiar.
3. **Implementar** solo lo de la fase. Si aparece algo fuera de alcance → `HALLAZGOS-NUEVOS.md`.
4. **Puerta de prueba** (§2), en orden. Si un nivel falla, se arregla antes de seguir.
5. **Cierre:** resultado de la puerta en `PROGRESO.md` (+ `qa/fase-N.md` con capturas) →
   commit (código + documentos) → resumen al usuario con «Lo que tienes que hacer tú» →
   **esperar su visto bueno** antes de la fase siguiente.

## 2. Puerta de prueba (cada fase)

### Nivel A — Estático y unitario

```bash
npm run typecheck
```
Número de errores ≤ línea base (los preexistentes se anotan en la pre-fase, no se arreglan aquí).

```bash
npx vitest run
```
Todo en verde. En particular:

```bash
npx vitest run src/pages/reserva/manualEntryPricingParity.test.ts src/components/booking/manual src/shared/manualEntry
```
- `manualEntryPricingParity.test.ts`: **88 casos idénticos, sin `-u`**.
- `ManualEntryWizardServices.test.tsx` (renderiza los 7), `manualEntryIcons.test.ts`
  (iconos registrados), tests nuevos de la fase.

Comprobación de alcance:
```bash
git diff --stat origin/main -- src/shared/manualEntry/manualEntrySchema.ts src/shared/manualEntry/manualEntryValidation.ts src/shared/manualEntry/legalCopy.ts src/pages/reserva/manualEntryBuilders.ts src/shared/bookingQuoteCore.ts supabase
```
Debe salir **vacío**.

### Nivel B — Banco de componentes (Playwright)

```bash
npm_config_prefix=~/Downloads/auditorias/qa-tools PLAYWRIGHT_BROWSERS_PATH=~/Downloads/auditorias/qa-tools/browsers \
  node scripts/qa/manual-entry/bench.mjs --out ~/Downloads/auditorias/formularios-qa/fase-N-bench
```
(Playwright vive aislado en `~/Downloads/auditorias/qa-tools`, ver H-N-11. La línea base de la
pre-fase está en `qa/linea-base.md`: la comparación es contra ella, no contra «todo en verde»,
porque varios criterios de maquetación y los escenarios fallan hoy a propósito.)
- Maquetación de los 7 en 320/360/375/414/768/1280: sin desborde, CTA visible, controles ≥ 44 px, consola limpia.
- **Paridad de lo enviado: 0 diferencias** con `baseline/payloads.json` (payload + telemetría).
- Escenarios de hallazgos (stepper de setos, coma decimal, elementos fantasma, Intro, «Atrás» en la primera pantalla) con el resultado esperado de la fase.
- **Diferencias previstas** (desde F7): el banco solo acepta como prevista la de P-04 (acceso
  difícil de palmeras oculto en el tramo más bajo): quitando de la línea base esas claves y el
  `stepId` de una pantalla que se queda sin preguntas, lo enviado debe ser idéntico, y el `patch`
  igual al de referencia. Se listan aparte en el informe; cualquier otra diferencia es un fallo.
- Si la fase cambia la interfaz, se adaptan `detectScreen`/`planItemScreen`/`applyActions`
  del banco. **Nunca** las respuestas ni la línea base.

### Nivel C — App real en local contra Supabase local

`scripts/qa/manual-entry/e2e-local.mjs` (reconstruido en la pre-fase; uso en
`scripts/qa/manual-entry/README.md`):

```bash
npm_config_prefix=~/Downloads/auditorias/qa-tools PLAYWRIGHT_BROWSERS_PATH=~/Downloads/auditorias/qa-tools/browsers \
  node scripts/qa/manual-entry/e2e-local.mjs --out ~/Downloads/auditorias/formularios-qa/fase-N-e2e --widths 375,1280
npm_config_prefix=~/Downloads/auditorias/qa-tools PLAYWRIGHT_BROWSERS_PATH=~/Downloads/auditorias/qa-tools/browsers \
  node scripts/qa/manual-entry/e2e-local.mjs --out ~/Downloads/auditorias/formularios-qa/fase-N-e2e-login --login
```

Recorre la reserva real en 5192 (`main`) y en 5191 (rama) con las mismas respuestas por
servicio y compara (además, cada total y cada huella deben ser **los de `qa/linea-base.md`**):
- **C1** pantallas de «Detalles» a 375 y 1280 px: desbordes, consola, respuestas HTTP ≥ 400;
- **C2** precio por profesional en «Profesionales» y huella SHA-256 de la colección guardada
  en `booking_resume_v2:*` (sin ids ni fechas): **deben coincidir**;
- **C3** eventos de `booking_funnel_events` (evento, servicio, `stepId`) en el mismo orden (los que llegan a la vez, < 100 ms, como en una pantalla que reúne varios pasos, se comparan como grupo: ver H-N-16);
- **C4** con sesión de cliente sembrado: filas de `booking_manual_declarations` equivalentes
  (mismas `declared_variables`, salvo ids y fechas).

Manual en el navegador del panel (375 × 812), en los servicios que toca la fase: recorrido
feliz + caminos difíciles (vacío, fuera de rango, coma, volver y cambiar una respuesta
condicionante, añadir/eliminar en repetibles, editar desde la revisión, confirmar sin
casilla, recargar a mitad).

### Nivel D — Corrección del jardinero (fases F2-F4 y F12)

Tres capas:
1. **Precio de la corrección** (en cada fase, automático): el E2E llama a
   `booking-authority` `recalculate_correction` con lo que guardó la reserva; debe dar el
   importe al profesional y las horas de la línea base.
2. **Interfaz del modal** (en cada fase que toque el shell): banco con `gardener=1`
   (sin casilla, «Recalcular precio», sin «Cambiar a fotos»).
3. **Recorrido real en el panel del jardinero** (F4 y F12): exige una solicitud creada, y
   crearla pasa por el pago de prueba → solo con autorización del usuario (Nivel E).

### Nivel E — Pago de prueba (solo F4 y F12, con autorización del usuario)

Reserva completa con tarjeta de prueba de Stripe en local: el importe cobrado = el mostrado
en «Profesionales» y en la línea base.

## 3. Cómo se demuestra que el precio no ha cambiado

| Capa | Prueba | Qué garantiza |
|---|---|---|
| Motor con los payloads del constructor | Paridad de precio (88 casos, snapshot congelado) | El motor y los constructores no se han tocado |
| Interfaz → payload | Banco nivel B (0 diferencias de `items`/`wasteRemoval` y de telemetría) | El rediseño envía exactamente lo mismo para las mismas respuestas |
| App completa | E2E nivel C (precio por profesional + huella) | Integración, `DetailsPage`, Edge Functions locales y datos reales de jardinero |
| Corrección en visita | Nivel D | El segundo consumidor del asistente sigue igual |
| Cobro | Nivel E | Importe cobrado = importe mostrado |

## 4. Qué hacer si algo falla

- **La paridad o el banco difieren:** se revierte el último cambio de la fase y se
  reintroduce por partes. No se toca la línea base.
- **Un cambio de interfaz necesitaría tocar el contrato:** se para, se anota en
  `HALLAZGOS-NUEVOS.md` como decisión pendiente y se consulta al usuario.
- **El entorno falla** (Docker, migraciones, puertos): se resuelve con el procedimiento de
  la pre-fase y se anota. No se sigue con un entorno dudoso.
- **El árbol de trabajo aparece revertido:** `git stash`, no commitear, restaurar desde el
  último commit de la rama y avisar al usuario.
