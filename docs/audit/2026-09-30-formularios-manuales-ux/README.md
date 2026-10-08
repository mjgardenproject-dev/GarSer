# Formularios manuales de «Detalles» — auditoría UX/UI y plan (ronda 2026-09-30)

Ronda nueva, empezada **desde cero** el 2026-09-30 a petición del usuario. Sustituye a las
dos rondas anteriores, que se han retirado:

| Qué se retiró | Dónde estaba | Cómo recuperarlo si hiciera falta |
|---|---|---|
| Rama `feat/formularios-manuales-fase-1` (4 commits, sin publicar) + cambios sin commitear | local | `git branch rescate ef036515c56032b1265c05fa08dd897fbdc32add` (reflog, ~90 días) |
| Rama `feat/formulario-manual-ux` (rediseño del 27-09, sin fusionar) | local | `git branch rescate 8927b906c4389443b064a751fcc9d1b29b3be925` |
| Plan anterior `docs/audit/2026-09-29-formularios-manuales/` | `main` (PR #42) | se borra en esta rama; sigue en el historial de `main` |

**Se conserva deliberadamente** el banco de pruebas de la Fase 0 del PR #42
(`src/pages/reserva/manualEntryPricingParity.test.ts`, sus 88 respuestas de referencia y
`scripts/qa/manual-entry/`): no es rediseño, es la red de seguridad que congela el precio
de los 7 formularios. Esta ronda lo usa como puerta de cada fase (ver `METODO-Y-PRUEBAS.md`).

Rama de trabajo: `feat/formularios-manuales-ux-v2`, creada desde `origin/main` (81397be).

## Documentos

| Documento | Para qué |
|---|---|
| [`AUDITORIA.md`](AUDITORIA.md) | §1 código · §2 interfaz real · §3 los 7 formularios uno a uno · §4 comparativa transversal · §5 buenas prácticas · §10 riesgos de precio |
| [`SISTEMA-UX.md`](SISTEMA-UX.md) | §6 sistema UX/UI propuesto · §7 componentes reutilizables y arquitectura |
| [`PLAN-IMPLEMENTACION.md`](PLAN-IMPLEMENTACION.md) | Pre-fase + fases · §9 plan por servicio y prioridades · §11 criterios de aceptación · §12 orden exacto |
| [`REGLAS.md`](REGLAS.md) | Reglas esenciales que no se negocian durante la implementación |
| [`METODO-Y-PRUEBAS.md`](METODO-Y-PRUEBAS.md) | Método de trabajo seguro y batería de pruebas por fase (incluida la paridad de precio) |
| [`HALLAZGOS-NUEVOS.md`](HALLAZGOS-NUEVOS.md) | Registro de hallazgos que aparezcan durante la implementación o que quedan fuera de alcance |
| [`PROGRESO.md`](PROGRESO.md) | Estado de cada fase, fecha, commit y resultado de su puerta de prueba |

## Estado

**Auditoría y plan terminados. Implementación NO empezada: esperando la aprobación del
usuario** (y sus respuestas a las decisiones D-01…D-09 de `PLAN-IMPLEMENTACION.md` §0).

## Cómo retomar en una sesión nueva

1. Leer este README, `REGLAS.md` y `PROGRESO.md` (en ese orden).
2. `git fetch && git checkout feat/formularios-manuales-ux-v2` y comprobar `git status` limpio.
3. Continuar por la primera fase de `PROGRESO.md` que no esté en verde, siguiendo
   `METODO-Y-PRUEBAS.md` al pie de la letra.
