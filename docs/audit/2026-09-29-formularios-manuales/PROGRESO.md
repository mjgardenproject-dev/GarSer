# Progreso — Formularios manuales de la reserva

Se actualiza en el mismo commit que el cambio que describe. Estados: ⬜ pendiente ·
🔄 en curso · 🧪 en prueba local · ⏸️ esperando aprobación · ✅ aprobado · ⛔ bloqueado.

## Estado general

| Fase | Estado | Aprobada por el usuario | PR / commits |
|---|---|---|---|
| Auditoría y plan | ✅ | 2026-09-29 (decisiones D1–D7) | — |
| Documentos de seguimiento | ✅ | — | `11a0dad` |
| 0 · Línea base y herramientas | ⏸️ | — | `83f3ff9` |
| 1 · Correcciones críticas | ⬜ | — | — |
| 2 · Componentes y capa de presentación | ⬜ | — | — |
| 3 · Estructura del asistente | ⬜ | — | — |
| 4.1 · Desbroce | ⬜ | — | — |
| 4.2 · Setos | ⬜ | — | — |
| 4.3 · Árboles | ⬜ | — | — |
| 4.3-D1 · Cantidad de árboles | ⬜ | — | — |
| 4.4 · Palmeras | ⬜ | — | — |
| 4.5 · Fitosanitarios | ⬜ | — | — |
| 4.6 · Césped | ⬜ | — | — |
| 4.7 · Plantas y arbustos | ⬜ | — | — |
| 5 · Repetibles, resumen y nota | ⬜ | — | — |
| 6 · Accesibilidad y documentación | ⬜ | — | — |
| 7 · QA final y despliegue | ⬜ | — | — |

## Pendientes que bloquean o condicionan

| # | Qué | Quién | Estado |
|---|---|---|---|
| D8 | Valor de `VITE_ENABLE_MANUAL_BOOKING_INPUT` en Vercel (`true` / `false`) | Usuario | Pendiente |
| P-01 | `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en el entorno, para el Nivel C de la prueba local | Usuario (opcional) | Pendiente |
| P-02 | ¿Hay despliegues de vista previa de Vercel por rama? (Nivel D) | Usuario (opcional) | Pendiente |
| P-03 | Redespliegue de `booking-authority` y `booking-manual-declaration` tras 4.3-D1 | Usuario | Pendiente (cuando llegue la fase) |

---

## Registro por fase

Plantilla que se copia al empezar cada fase:

```
### Fase X — <nombre>
- Inicio: AAAA-MM-DD · Fin: AAAA-MM-DD
- Hallazgos que cierra: <IDs del README>
- Cambios: <lista breve, con archivos>
- Hallazgos nuevos: <H-xx o «ninguno»>

Puerta de prueba local
- A · tsc: ✅/❌ · eslint: ✅/❌ · vitest: N archivos / N tests ✅/❌ · paridad: idéntica ✅/❌ · build: ✅/❌
- B · banco visual: desbordes 0/N · CTA visible ✅/❌ · controles ≥44 px ✅/❌ · payload = fixture ✅/❌ · capturas enviadas ✅
- C · app real: ✅ / ❌ / no ejecutado (motivo)
- D · móvil del usuario: ✅ / ❌ / no ejecutado (motivo)

Aprobación: pendiente / aprobada AAAA-MM-DD
```

### Auditoría y plan — ✅
- Fecha: 2026-09-29
- Resultado: informe (https://claude.ai/artifact/A6vZDrhMBZn23pvbaS3yTc), plan y decisiones
  D1–D7 aprobadas. D8 pendiente del valor.
- Cambios en el código: ninguno.

### Fase 0 — Línea base y herramientas — ⏸️ esperando aprobación
- Inicio: 2026-09-29 · Fin: 2026-09-29
- Hallazgos que cierra: ninguno (fase sin cambios en la web). Deja reproducidos con el banco
  V1, V2, V4, V5, S-SET-1, S-ARB-1, S-PAL-1 y S-FIT-1.
- Cambios:
  - `src/pages/reserva/manualEntryParityFixtures.ts`: 88 respuestas de referencia completas
    (todas las ramas de los 7 formularios) y configuraciones de jardinero de prueba con precios
    distintos por rama.
  - `src/pages/reserva/manualEntryPricingParity.test.ts` + snapshot: congela `patch`,
    `declaredVariables` y presupuesto completo de cada respuesta (88), exige que todas sean
    cotizables y comprueba que las respuestas cubren cada opción, cada interruptor, los
    extremos de cada rango, la retirada activada/desactivada y varios elementos (7 tests).
    Probado a la inversa: quitar una rama o cambiar un valor hace fallar el test.
  - `scripts/qa/manual-entry/`: banco visual (página + Playwright), línea base de lo enviado
    y telemetría (`baseline/payloads.json`) y README.
  - `docs/audit/2026-09-29-formularios-manuales/qa/fase-0-linea-base.md`: informe del banco
    antes de cualquier cambio.
- Hallazgos nuevos: H-02 (128 errores de `tsc` previos), H-03 (13 archivos de test necesitan
  `VITE_SUPABASE_URL`).

Puerta de prueba local
- A · tsc: 128 errores, los mismos que `main` sin cambios; ninguno en archivos nuevos ✅ ·
  eslint (archivos nuevos): 0 errores, 1 aviso de fast refresh en la página del banco ✅ ·
  vitest: 98 archivos / 692 tests ✅ (línea base previa: 97 / 596) · paridad: 88 snapshots
  escritos sobre el código de `main` ✅ · build: ✅, sin rastro de fixtures ni banco en `dist`
- B · banco visual (línea base, se espera que falle en lo que la auditoría encontró):
  432 pantallas medidas · desbordan 30 (17 a 320 px, 8 a 360, 3 a 375, 2 a 414; máximo +54 px) ·
  CTA fuera de la vista inicial en 245 pantallas móviles · 44 controles distintos < 44 px ·
  0 errores de consola · lo enviado = referencia en 88/88 · línea base determinista
  (segunda pasada: 0 diferencias) · escenarios 0/7 (los 7 hallazgos reproducidos) ·
  77 capturas a 375 px
- C · app real: no ejecutado (faltan `VITE_SUPABASE_URL` y clave pública; pendiente P-01).
  Tampoco aplica: la fase no cambia la web.
- D · móvil del usuario: no aplica (sin cambios en la web).

Aprobación: pendiente
