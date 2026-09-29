# Progreso — Formularios manuales de la reserva

Se actualiza en el mismo commit que el cambio que describe. Estados: ⬜ pendiente ·
🔄 en curso · 🧪 en prueba local · ⏸️ esperando aprobación · ✅ aprobado · ⛔ bloqueado.

## Estado general

| Fase | Estado | Aprobada por el usuario | PR / commits |
|---|---|---|---|
| Auditoría y plan | ✅ | 2026-09-29 (decisiones D1–D7) | — |
| Documentos de seguimiento | ✅ | — | este commit |
| 0 · Línea base y herramientas | ⬜ | — | — |
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
