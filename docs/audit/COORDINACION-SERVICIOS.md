# Coordinación entre las auditorías de servicio

> Siete auditorías a la vez, una por servicio, cada una en su rama. Este fichero existe por
> una razón concreta: **el motor de precios de los siete servicios vive en un solo
> fichero**, así que aunque cada auditoría toque solo su servicio, todas editan las mismas
> líneas.
>
> Dos secciones y nada más: el registro de qué toca cada rama, y los hallazgos que afectan
> a más de un servicio.

---

## 1. Las dos reglas

**Regla 1 — No se toca el servicio de otro.** Ni su configurador, ni su bloque del motor,
ni su encuesta manual, ni su runner.

**Regla 2 — Un hallazgo que afecta a más de un servicio se anota aquí, no se arregla.** Va
a §3 y espera a la ronda transversal final. Arreglarlo en la rama de un servicio es lo que
produce conflictos en el motor de precios, que es el único sitio donde un conflicto mal
resuelto cuesta dinero.

Cómo distinguirlos, en una frase: **si el arreglo sirve igual para un servicio que no estás
auditando, es transversal.**

---

## 2. Registro de ficheros compartidos

Cada auditoría añade su fila al terminar. Si dos ramas aparecen en la misma, hay que mirarla
antes de integrar nada.

| Fichero compartido | Ramas que lo tocan | Qué le hace cada una |
|---|---|---|
| _(vacío — se rellena según avancen las auditorías)_ | | |

Los ficheros que suelen aparecer aquí, para que sepas cuáles vigilar:
`src/shared/bookingQuoteCore.ts`, `src/pages/reserva/ProvidersPage.tsx`,
`src/shared/manualEntry/manualEntrySchema.ts`, `src/pages/reserva/manualEntryBuilders.ts`,
`supabase/functions/booking-authority/index.ts`, `src/types/index.ts`,
`scripts/readiness/_harness.mjs`.

---

## 3. Hallazgos transversales — se anotan, no se arreglan

Antes de escribir uno, **búscalo aquí**: en la tanda anterior tres sesiones apuntaron el
mismo fallo de redondeo sin saberlo. Para cada uno: qué falla y dónde (`file:line`), cómo lo
reprodujiste, y a qué servicios crees que afecta.

### 3.1 · Pendientes de decisión del usuario

| # | Qué pasa |
|---|---|
| A | **No existe ningún reembolso, en ninguna parte.** El cliente paga la tarifa, el profesional rechaza, la reserva se cancela y el dinero no vuelve. Necesita política antes que código |
| B | **El cliente no puede cancelar su reserva** desde su área: solo tiene «Chat». Depende de A |

### 3.2 · Encontrados durante estas auditorías

| # | Servicio que lo encontró | Qué falla | Dónde | Afecta a |
|---|---|---|---|---|
| T1 | transversal (ronda previa a los servicios, 2026-09-09) | **No se comprueba la licencia fitosanitaria en ninguna parte del backend.** Un trabajo con producto químico convencional (fitosanitarios no ecológicos, o desbroce con herbicida) es reservable con un jardinero **sin** carnet. `booking-authority` y `booking-payment` tienen 0 referencias a `has_phytosanitary_license`. `ProvidersPage` calcula `requiresCertifiedLicense` pero **nunca filtra la lista** por ese campo (solo cambia textos). Reproducido leyendo código; no probado E2E. | `src/pages/reserva/ProvidersPage.tsx:411-475` (no hay `.filter` por licencia) · `supabase/functions/booking-authority/index.ts` (0 refs) | fitosanitarios, desbroce. El arreglo correcto es un filtro en la capa compartida `booking-authority` / `ProvidersPage`, por eso se anota aquí. |
| T2 | transversal (2026-09-09) | Redondeo de horas `if (totalHours > 8) totalHours *= 0.9;` + `Math.ceil(totalHours*2)/2`. **Comprobado y NO reproducido** en `main`: barrido `totalHours` 8,001–40,000 @ 0,001 → 0 casos de sobre-redondeo frente a referencia decimal exacta. Línea frágil pero sin sobrecoste observable hoy. Se deja anotado por si un servicio con horas altas lo re-encuentra: **no es un fallo confirmado**. | `src/shared/bookingQuoteCore.ts:1349-1350` | cualquier servicio que supere 8 h brutas (setos, césped grandes, desbroce) |

---

## 4. Cómo se cierra un servicio

1. Runner en verde con el motor en proceso: `READINESS_ENGINE=local node scripts/readiness/<servicio>.mjs`
2. **Tipos:** `npx tsc --noEmit -p tsconfig.app.json` — este es el gate real. `tsconfig.json`
   tiene `"files": []` y sólo `references`, así que `tsc -p tsconfig.json` NO comprueba ningún
   fichero (siempre pasa: es un no-op). Criterio: `main` arrastra **173 errores** (en su
   mayoría `TS6133` de variables sin usar); el número **no puede subir de 173**, y cualquier
   fichero que toque tu servicio queda **sin errores nuevos**. `npx vitest run` sin fallos.
3. Informe al usuario. **Él abre la PR y decide el turno.**
4. Tras el merge: `supabase db push` → `supabase functions deploy <fn> --use-api` → Vercel.
5. Se ejecutan **todos** los runners, ya por HTTP, no solo el del servicio recién integrado.
6. Siguiente servicio.

---

## 5. Estado de las auditorías

| Rama | Servicio | Estado |
|---|---|---|
| `auditoria/cesped` | Corte de césped | Sin empezar |
| `auditoria/setos` | Poda de setos | Sin empezar |
| `auditoria/arboles` | Poda de árboles | Sin empezar |
| `auditoria/palmeras` | Poda de palmeras | Sin empezar |
| `auditoria/arbustos` | Poda de plantas y arbustos | Sin empezar |
| `auditoria/desbroce` | Desbroce de malas hierbas | Sin empezar |
| `auditoria/fitosanitarios` | Servicios fitosanitarios | Sin empezar |
