# Hallazgos nuevos detectados durante la implementación (2026-09-29)

Aquí va todo lo que aparezca durante las fases y **no** estuviera en la auditoría (los
hallazgos de la auditoría tienen IDs V*/S-* en el [`README.md`](README.md)).

**Reglas**

- Cada hallazgo se verifica contra el código actual antes de apuntarlo, con evidencia
  (archivo:línea, captura o test que lo reproduce).
- No se corrige de paso. Se corrige solo si bloquea la fase en curso, y entonces se dice en
  el commit y aquí; si no, queda propuesto para una fase o una ronda aparte.
- Si afecta a precio, datos, Supabase o Edge Functions, se marca **⚠️ Afecta a datos/precio**
  y requiere tu decisión antes de tocar nada.
- Estados: 🆕 nuevo · 🔍 verificado · 📋 planificado (fase X) · ✅ corregido · 🚫 descartado.

**Plantilla**

```
## H-xx — <título> — <estado>

- Severidad: Crítica / Alta / Media / Baja
- Detectado en: Fase X, AAAA-MM-DD
- Evidencia: <archivo:línea, pasos, captura, test>
- Qué pasa: <efecto para el cliente o el jardinero>
- ⚠️ Afecta a datos/precio: sí / no
- Propuesta: <qué hacer y en qué fase>
- Decisión: <pendiente / tuya, fecha>
```

---

## H-01 — Dos Edge Functions importan los archivos compartidos de la entrada manual — 🔍 verificado

- Severidad: Media (riesgo de despliegue)
- Detectado en: preparación de la Fase 0, 2026-09-29
- Evidencia: `supabase/functions/booking-authority/index.ts:27` y
  `supabase/functions/booking-manual-declaration/index.ts:10-15` importan
  `src/shared/manualEntry/manualEntryValidation.ts`, `manualEntrySchema.ts` y `legalCopy.ts`.
  La auditoría solo citaba `booking-authority`.
- Qué pasa: cualquier cambio en esos archivos debe redesplegarse en las dos funciones para
  que el servidor y la web no diverjan.
- ⚠️ Afecta a datos/precio: sí, si se tocan esos archivos. En esta ronda solo lo hace D1.
- Propuesta: recogido en el plan (Fase 4.3-D1 y pendiente P-03 de `PROGRESO.md`).
- Decisión: no requiere; es información para el despliegue.
