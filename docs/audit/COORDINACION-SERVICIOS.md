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
| `scripts/readiness/cesped.mjs` | `auditoria/cesped` | Reescrito: `serviceId` corregido (el de la skill estaba obsoleto), predicciones recalculadas contra el motor real, hallazgos T2/T3/T7 marcados `untested(...)` (no FALLA) citando su número aquí. No toca `_harness.mjs`. |
| `src/shared/bookingQuoteCore.ts` | `auditoria/cesped` | **Fase 3 (2026-09-11), solo dentro del bloque `if (bookingData.lawnZones?.length)` de horas (antes L1259-1265):** añadida la constante `LAWN_MAX_PLAUSIBLE_AREA_M2 = 2000` (junto a `DEFAULT_HEDGE_SURCHARGES`/`DEFAULT_SHRUB_SURCHARGES`) y un `pushWarning('lawn_area_implausible', …)` por zona que supere ese umbral. Arregla el hallazgo #2 del informe de césped. **No toca** `getDurationMultiplier`, el redondeo de horas (`:1349-1350`), ni ningún bloque de otro servicio — eso es T2/T3, transversal, sin tocar. |

La Fase 2 de césped fue de solo lectura. En Fase 3 (autorizada por el usuario el 2026-09-11)
se corrigió únicamente el hallazgo #2 (propio de césped, ver fila de arriba). Los hallazgos
T2, T3, T4, T5, T6 y T7 de abajo siguen **anotados, no arreglados** — incluido T3, que el
usuario decidió explícitamente NO corregir con el enfoque que se había propuesto (ver su nota
en la fila de T3).

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
| T2 | transversal (2026-09-09); **reproducido por césped (2026-09-11)** | Redondeo de horas `if (totalHours > 8) totalHours *= 0.9;` + `Math.ceil(totalHours*2)/2`. La ronda transversal NO lo reprodujo barriendo `totalHours` en decimal (8,001–40,000 @ 0,001) — ese método no lo encuentra porque el residuo depende de la CADENA real de división/multiplicación, no del valor decimal final. Césped SÍ lo reprodujo con una entrada física real: `(5000/150)*0.9` en JS da `30.000000000000004` (residuo `3,55e-15`) en vez de `30` exacto; `Math.ceil(30.000000000000004*2)/2` sube a **30,5 h** en vez de 30,0 h. Verificado dos veces: motor en proceso (`READINESS_ENGINE=local`) y HTTP contra `booking-authority` con `{lawnZones:[{quantity:5000,state:'normal'}], wasteRemoval:false, dataInputMode:'manual'}` (serviceId césped `fe9d2d9e-3f62-4184-aa80-a3289d7c378a`) → mismo resultado los dos. Es un fallo confirmado, no solo una línea frágil: sobrecobra 0,5 h de agenda bloqueada cada vez que `quantity/yield` cae en una fracción binaria imprecisa que además cruza el umbral de 8 h. | `src/shared/bookingQuoteCore.ts:1349-1350` | cualquier servicio que supere 8 h brutas (setos, césped grandes, desbroce, fitosanitarios con área grande) |
| T3 | césped (2026-09-11) | **El multiplicador de horas de "descuidado"/"muy descuidado" está fijo en código y no lee `condition_surcharges`, que es justo la config que el PRECIO sí usa.** `getDurationMultiplier(state)` devuelve 1.0/1.3/1.7 fijos; el precio de las mismas zonas usa `resolveSurchargePercent(config.condition_surcharges...)` (1.20/1.50 en el jardinero sembrado de césped). Con este seed: precio de "muy_descuidado" sube un 50 % (config), pero las horas suben un 70 % (fijo) → 1000 m² muy_descuidado da 270 €/**10,5 h**, cuando con el mismo 50 % que ya paga el cliente por precio serían 270 €/**9,0 h**. Reproducido con el motor en proceso, tabla completa en el informe de césped §2. Afecta a las 4 llamadas de `getDurationMultiplier` en el fichero, una por cada bloque de servicio. **Decisión del usuario (2026-09-11): NO se corrige igualando horas al recargo de precio.** Son dos cosas distintas por diseño — el recargo es lo que el jardinero decide *cobrar* de más, el multiplicador es lo que la faena *tarda* de verdad. Un jardinero que configure un 0 % de recargo para "muy_descuidado" (p. ej. como gesto comercial) seguiría necesitando más tiempo real: acoplar horas a precio le reservaría el tiempo de un césped normal y no llegaría a terminar. El fix correcto, si lo hay, no es "usar el mismo %" sino separar ambos conceptos con su propio parámetro de tiempo — pendiente de decidir en la ronda transversal, no en una rama de servicio. | `src/shared/bookingQuoteCore.ts:412-419` (`getDurationMultiplier`, fijo) vs `:1438-1439` (precio césped, config) — mismo patrón en `:1275` (setos), `:1302` (desbroce), `:1312` (arbustos) | césped, setos, desbroce, arbustos — cualquier servicio que use `getDurationMultiplier` para horas y `condition_surcharges`/`resolveSurchargePercent` para precio con la misma zona |
| T4 | césped (2026-09-11) | **Al aceptar un cambio de precio, `duration_hours` (y por tanto `end_time` y los bloques de agenda) NO se actualizan — solo cambia `total_price`.** Probado end-to-end: reserva 1000 m² descuidado (216 €/8 h) → jardinero corrige a 1400 m² descuidado y propone 303 € → cliente acepta → `bookings.total_price=303` (correcto) pero `duration_hours` sigue en `8`, `end_time` sigue en la hora original, y `booking_blocks` sigue teniendo solo los bloques originales. Con el motor, 1400 m² descuidado son 11 h reales, no 8. La función solo actualiza `availability` para el rango `[inicio, inicio+duration_hours_ANTIGUO)` — nunca recalcula duración. Consecuencia medida: el "¿se hizo el trabajo?" del cliente se habilita comparando contra `date+start_time+duration_hours` (`needsClientConfirmation`, que usa el mismo `duration_hours` desactualizado), así que el cliente puede ver el aviso de confirmación 3 h antes de que el trabajo real (11 h) pueda haber terminado. | RPC `public.respond_booking_price_change(uuid,boolean,uuid)`, definida en `supabase/migrations/20260909121000_price_change_accept_uses_canonical_schedule.sql:112,117` (`v_duration := COALESCE(v_booking.duration_hours, 1)` — nunca se recalcula) · consumidor del dato desactualizado: `src/shared/bookingStatus.ts:105-111` (`serviceEndMs`) | los 7 servicios — cualquier cambio de precio que también cambie la cantidad/superficie declarada cambia las horas reales, y esta RPC es compartida |
| T5 | césped (2026-09-11) | **El botón "Aceptar nuevo precio" / "Rechazar" del DASHBOARD del cliente (`/`, "Hola de nuevo, {nombre}") no hace nada al pulsarlo.** Se renderiza normal (no disabled, sin error visual) pero `cardHandlers` en el componente del dashboard no incluye `onAcceptPriceChange` ni `onRejectPriceChange`, así que el `onClick` del botón llama a `undefined?.(booking)` y no pasa nada: sin request de red, sin cambio de estado. Reproducido con clic real (coordenadas) y con `.click()` programático sobre el elemento — ninguno de los dos dispara nada. **Los mismos botones SÍ funcionan** en `/bookings` (la página completa "Mis reservas", alcanzable con "Ver todas"), que sí conecta `onAcceptPriceChange={() => void respondToPriceChange(booking, true)}`. Un cliente que solo mire el dashboard (lo primero que ve al entrar) no tiene forma de responder a una propuesta de precio. | Roto: `src/components/client/ClientBookingLauncher.tsx:142-150` (objeto `cardHandlers`, sin las dos claves) · Funciona: `src/components/client/BookingsList.tsx:303` | los 7 servicios — `ClientBookingLauncher` es el dashboard genérico, no depende del servicio |
| T6 | césped (2026-09-11) | Menor/cosmético: en el panel del jardinero, "Solicitudes de Reserva", la cabecera de cada solicitud muestra `08:00:00 - 16:00:00 (1h)` — el "(1h)" es SIEMPRE 1 aunque el servicio dure 8 h (correcto un poco más abajo, en "Duración estimada: 8h"). Causa: `{request.booking_blocks?.length || 0}h` usa un array sintético de un único elemento `{start_time, end_time}` construido solo para formatear el rango de texto (no son filas reales de la tabla `booking_blocks`, que para esta reserva sí tenía 8 filas correctas en BD). No afecta al precio ni a las horas reales, pero es una cifra visiblemente incoherente en la misma pantalla y podría hacer dudar al jardinero sobre cuánto dura el trabajo antes de aceptar. | `src/components/gardener/BookingRequestsManager.tsx:502` (usa `.length` del array sintético de `:224`) en vez de `request.duration_hours` (correcto, usado en `:513`) | los 7 servicios — `BookingRequestsManager` es el panel de solicitudes genérico |
| T7 | césped (2026-09-11) | **Un trabajo que no cabe en un único día se queda sin ningún hueco reservable en ninguna fecha, y sin ningún aviso al cliente de por qué.** El fixture solo siembra jornadas de un día (L-V 08-18 = 10 bloques de 1h, sábado 5). Cualquier servicio cuyas horas estimadas superen esos 10 bloques queda excluido de `preview_providers`/`valid_hours` en **todas** las fechas probadas (21 días), con el mismo código genérico `no_reservable_availability` que se usa para "esta fecha en concreto no tiene hueco" — nada distingue "prueba otro día" de "este trabajo no se puede reservar nunca". No es exclusivo de estados con recargo (T3): reproducido también con **1700 m² de césped en estado NORMAL** (sin ningún recargo de por medio, `(1700/150)·0,9=10,2h→10,5h→11 bloques`), así que es un hueco de producto — falta reserva multi-día o, como mínimo, un aviso de "trabajo extenso" antes de mandar al cliente a un paso de selección sin huecos — no un efecto secundario de T3. | No hay ningún sitio que calcule "¿cabe este trabajo en algún día?" de forma explícita ni que avise de ello; el síntoma se observa en `supabase/functions/booking-authority/index.ts` (acciones `preview_providers`/`valid_hours`, exclusión `no_reservable_availability`) | los 7 servicios — cualquiera cuyo `estimatedHours` pueda superar la jornada más larga sembrada para un profesional |

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
| `auditoria/cesped` | Corte de césped | Fases 1-3 completas (2026-09-11). Corregido el hallazgo propio (#2, aviso de plausibilidad de área). T2/T3/T4/T5/T6/T7 anotados aquí, sin tocar — esperan ronda transversal. Runner en verde, listo para PR |
| `auditoria/setos` | Poda de setos | Sin empezar |
| `auditoria/arboles` | Poda de árboles | Sin empezar |
| `auditoria/palmeras` | Poda de palmeras | Sin empezar |
| `auditoria/arbustos` | Poda de plantas y arbustos | Sin empezar |
| `auditoria/desbroce` | Desbroce de malas hierbas | Sin empezar |
| `auditoria/fitosanitarios` | Servicios fitosanitarios | Sin empezar |
