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
node scripts/qa/manual-entry/bench.mjs --out /tmp/garser-manual-entry-qa --strict
```
- Maquetación de los 7 en 320/360/375/414/768/1280: sin desborde, CTA visible, controles ≥ 44 px, consola limpia.
- **Paridad de lo enviado: 0 diferencias** con `baseline/payloads.json` (payload + telemetría).
- Escenarios de hallazgos (stepper de setos, coma decimal, elementos fantasma, Intro, «Atrás» en la primera pantalla) con el resultado esperado de la fase.
- Si la fase cambia la interfaz, se adaptan `detectScreen`/`planItemScreen`/`applyActions`
  del banco. **Nunca** las respuestas ni la línea base.

### Nivel C — App real en local contra Supabase local

Script E2E a reconstruir en la pre-fase (`scripts/qa/manual-entry/e2e-local.mjs`; el de la
ronda anterior se retiró con su rama): recorre la reserva real en 5192 (`main`) y en 5191
(rama) con las mismas respuestas por servicio y compara:
- **C1** pantallas de «Detalles» a 375 y 1280 px: desbordes, consola, respuestas HTTP ≥ 400;
- **C2** precio por profesional en «Profesionales» y huella SHA-256 de la colección guardada
  en `booking_resume_v2:*` (sin ids ni fechas): **deben coincidir**;
- **C3** eventos de `booking_funnel_events` (evento, servicio, `stepId`) en el mismo orden;
- **C4** con sesión de cliente sembrado: filas de `booking_manual_declarations` equivalentes
  (mismas `declared_variables`, salvo ids y fechas).

Manual en el navegador del panel (375 × 812), en los servicios que toca la fase: recorrido
feliz + caminos difíciles (vacío, fuera de rango, coma, volver y cambiar una respuesta
condicionante, añadir/eliminar en repetibles, editar desde la revisión, confirmar sin
casilla, recargar a mitad).

### Nivel D — Corrección del jardinero (fases F2-F4 y F12)

Con una reserva manual creada en local: panel del jardinero → solicitud → corregir datos
→ «Recalcular precio» con los mismos datos = **mismo importe** que la línea base; con un
dato cambiado, el importe esperado por el motor.

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
