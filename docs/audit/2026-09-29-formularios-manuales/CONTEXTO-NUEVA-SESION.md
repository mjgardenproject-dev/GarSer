# Contexto para continuar la ronda en una sesión nueva

Este archivo recoge lo que la sesión que hizo la auditoría y la Fase 0 sabía y **no** está en
el resto de documentos. Una sesión nueva debe leerlo después de `README.md`,
`PLAN-IMPLEMENTACION.md`, `PROGRESO.md` y `HALLAZGOS-NUEVOS.md`.

## Cómo quiere trabajar el usuario

- Todo en español. Informes claros, con evidencia; nada de describir sin diagnosticar.
- **Una fase cada vez.** Al terminar una fase: puerta de prueba local completa (Niveles A–D del
  plan), `PROGRESO.md` y `HALLAZGOS-NUEVOS.md` actualizados en el mismo commit, capturas
  antes/después enviadas, y **parar a pedir aprobación** antes de la siguiente.
- Nada que cambie datos, precio, Supabase o Edge Functions sin decisión explícita suya. La
  única excepción aprobada es D1 (cantidad de árboles, paso 4.3-D1).
- Prioridades: claridad > estética, móvil > escritorio, prevención de errores > corrección,
  reutilizar > duplicar, nada de refactors innecesarios. Evitar el aspecto «generado por IA»
  (exceso de tarjetas, bordes, sombras, degradados, animaciones decorativas).

## Reglas de seguridad aprendidas

- **Nunca** `vitest -u` sobre `manualEntryPricingParity.test.ts` ni `bench.mjs --write-baseline`,
  salvo en 4.3-D1 y revisando el diff a mano.
- Si falla la paridad o la línea base, la fase se detiene: no se «arregla» el test.
- Contra el Supabase de producción: sin iniciar sesión y sin pasar de la pantalla de
  profesionales (con sesión, enviar escribe en `booking_manual_declarations`). Si hay Supabase
  local (`supabase start`), el Nivel C puede cubrir el flujo completo.
- No hacer `git stash` ni cambiar de rama mientras el banco corre en segundo plano: la sesión
  anterior invalidó así una pasada y tuvo que repetirla.
- Sin `.env`, los tests y el build se lanzan con valores ficticios de Supabase (ver plan, H-03).

## Datos del código que conviene tener presentes

- `manualEntrySchema.ts`, `manualEntryValidation.ts` y `legalCopy.ts` los importan dos Edge
  Functions (`booking-authority`, `booking-manual-declaration`). La presentación nueva va en
  una capa solo de cliente (`manualEntryPresentation.ts`), nunca en el esquema.
- `ManualEntryWizard` lo reutiliza también el panel del jardinero
  (`BookingRequestsManager.tsx`, corrección con `requireConsent=false` y «Recalcular precio»).
  Hay que probar ese uso en cada fase que toque el asistente (el banco lo hace con `?gardener=1`).
- Contratos que no cambian: `onSubmit({ items, wasteRemoval })`, `onDraftChange`, la forma de
  `manualDraft` en `servicesData`, los `stepId` que se emiten con `onStepComplete` (al agrupar
  pasos en una pantalla, se sigue emitiendo uno por cada paso del esquema incluido).
- `DetailsPage.tsx`: el asistente vive hacia la línea 4686–4722; el CTA fijo del modo fotos,
  hacia la 6734 (oculto en modo manual). `handleManualSubmit` no se toca.
- `syncManualDraftExtras` sincroniza los extras de palmera con la tarjeta **por índice**: al
  permitir eliminar elementos (Fase 5) hay que probar que no se desalinean.
- Palmeras: el builder descarta «Acceso difícil» en el tramo más bajo
  (`isLowestRangeThresholdForSpecies`); D6 lo oculta en la interfaz importando esa función.
- Fitosanitarios: el asistente deja `aboveThreeMeters=false` y `wantsEndotherapy=false` en todas
  las zonas y `wasteRemoval=true` (el builder lo anula). Las respuestas de campos ocultos se
  conservan; no se borran (sería cambiar el dato).
- Repetición de reserva: `startsOnRebookSummary` arranca el asistente en el resumen; debe
  seguir igual.
- La base de `tsc` tiene 128 errores previos (H-02): el criterio es no añadir ninguno.

## El banco de pruebas

- `node scripts/qa/manual-entry/bench.mjs --out <dir>` (unos 4-5 min). Ver su README.
- La página del banco (`main.tsx`) replica el marco de `DetailsPage` en modo manual: si una fase
  cambia ese marco, hay que replicarlo o extraerlo a un componente compartido.
- Cuando cambie la interfaz, se adaptan `detectScreen`, `planItemScreen` y `applyActions`; las
  respuestas de referencia y la línea base no se tocan.
- En la Fase 0 los 7 escenarios fallan a propósito (son los hallazgos). A medida que las fases
  los corrijan deben pasar; desde la Fase 1 conviene lanzar con `--strict` los criterios ya
  cubiertos.

## Pendientes del usuario

- D8: valor de `VITE_ENABLE_MANUAL_BOOKING_INPUT` en Vercel.
- P-01 / P-02: variables de Supabase para el Nivel C y vistas previas de Vercel para el Nivel D.
- Aprobación de la Fase 0.

## Enlaces

- Informe de la auditoría (con capturas y el sistema UX propuesto):
  https://claude.ai/artifact/A6vZDrhMBZn23pvbaS3yTc
