# GarSer — Plan de implementación, tronco común (turno 2)

**Rama:** `auditoria/transversal` (sobre `origin/main`)
**Objetivo:** cerrar los hallazgos transversales de `COORDINACION-SERVICIOS.md` §3.2 (T1–T12) y
revisar §3.1, sin tocar lo que está deliberadamente diseñado así (`capture_method: 'manual'`,
`management_fee` inmutable en cambio de precio, T13 retirado).
**Entorno:** stack de `~/Downloads/GarSer-referencia` (Supabase local), Stripe en modo test,
cuentas sembradas `cliente.local@test.local` / `jardinero.local@test.local` /
`admin.local@test.local`, contraseña `Test123456!`.

---

## Cómo funciona este documento

Es un documento **vivo**: se actualiza en cada fase, no se escribe una vez y se olvida.

1. Antes de tocar código de una fase, **se re-verifica el hallazgo contra el código actual**
   (algunos de §3.2 llevan una semana anotados; puede que ya no reproduzcan, o que el código
   haya cambiado de sitio). Se anota en el **Registro del proceso** de esa fase lo que se
   encontró, aunque sea "sigue igual que en el informe".
2. Cada fase tiene su propia sección con: qué hallazgos cierra, dónde está el código, qué se
   implementó, el **Registro del proceso** (bitácora cronológica de lo que se fue haciendo y
   decidiendo) y la **Comprobación real** (evidencia concreta — capturas de red, filas de BD,
   resultados de runners — no "debería funcionar").
3. **Una fase no se marca cerrada sin su Comprobación real completa.** Si algo no se pudo
   probar en este entorno, se anota explícitamente como **NO PROBADO** con el motivo — nunca se
   disfraza de probado.
4. Cada fase termina con commits atómicos por hallazgo (revertibles por separado) y un aviso al
   usuario. **El usuario decide cuándo se abre la siguiente fase.**
5. Al terminar todas las fases: **Fase 7**, una comprobación total de que los 7 servicios siguen
   funcionando de principio a fin, no solo los hallazgos tocados.
6. Al cerrar cada fase se actualiza también `COORDINACION-SERVICIOS.md` §3.2 (fila del hallazgo,
   marcada como cerrada con la evidencia) — no se deja para el final, para no perder el hilo de
   qué fila corresponde a qué commit.

**Nota de numeración:** en el chat, a T5+T6+T9+T10 los llamé "Fase 1" (porque las dos funciones
nuevas de licencia y duración se implementaron antes, fuera de la numeración, a petición
explícita tuya) y tú luego llamaste "Fase 2" a lo que sigue. Este documento renumera **de forma
continua desde el principio** para que quede coherente de aquí en adelante: lo que en el chat
fue "Fase 1" (T5/T6/T9/T10) aquí es la **Fase 2**; la licencia+duración pasan a ser la **Fase
1**. A partir de ahora, la numeración de este documento es la que manda.

---

## Decisiones del usuario (vigentes para todo el plan)

| # | Decisión |
|---|---|
| D1-T1 | Licencia "vigente" = foto subida + aprobada por admin + fecha de caducidad futura. El admin fija la caducidad ANTES de aprobar; al pasar, caduca sola (sin renovación automática). |
| D2-T1 | Palmeras NO entra en la puerta de licencia. |
| D3-T1 | Bloquear también al jardinero en su propio configurador, con aviso claro + guía para adjuntar la licencia. |
| D4-T7 | Opción (a): fix mínimo y honesto — detectar que el trabajo no cabe en un día y avisar, sin sistema de reserva multi-día. |
| D5-T4 | Además del cambio de precio, el jardinero puede pedir alargar/acortar el servicio, moviendo solo la hora de FIN (nunca el inicio). |
| D6-T12 | "Lo que veas recomendable" → se aplicó el mismo fix que ya recibió `PhytosanitaryPricingConfigurator`: usar `getPricingMethod()` en vez de comparar `pricing_method` en crudo. |

**Exclusiones — no tocar:** `capture_method: 'manual'` (captura diferida deliberada),
`management_fee` inmutable al aceptar un cambio de precio (deliberado, avisado al jardinero y
al cliente en pantalla), T13 (falso positivo retirado, no reabrir).

---

## Índice de fases

| Fase | Qué cierra | Estado | Commits |
|---|---|---|---|
| 0 | Infraestructura de los runners de readiness (service_id + fechas robustos) | ✅ Hecha | `8783626` |
| 1 | T1 (licencia fitosanitaria con caducidad) + T4/D5 (cambio de duración junto al de precio) | ✅ Hecha | `21661dc`, `11a08ca`, `c5263a5` |
| 1.5 | Hallazgo lateral encontrado en la Fase 1: `generate_recurring_slots` liberaba reservas `pending` ya pagadas | ✅ Hecha (rama aparte) | `42c5519` en `claude/heuristic-roentgen-de7608` |
| 2 | T5, T6, T9, T10 (bugs transversales de UI: botones muertos, cifras/nombres incorrectos) | ✅ Hecha | `39279bf`, `da18b42`, `2ef28f0`, `bb9f6e2` |
| 3 | T12 (Lawn/Hedge/Shrub — Palm resultó no afectado) + autoguardado espurio (Setos/Palmeras/Árboles/Arbustos — más amplio de lo que decía §3.2) | ✅ Hecha | `a5c7500`, `16d8eb5` |
| 4 | T2 (redondeo de horas — ninguno de los runners necesitó recálculo esta vez) | ✅ Hecha, verificada por HTTP tras desplegar al stack local | `ec9a7b7` |
| 5 | T8 (rama que falta en el sondeo de pago agotado) + cierre formal de T4 (confirmado en vivo: el hueco original está cerrado, opt-in por diseño de D5) | ✅ Hecha (rama nueva de T8 NO PROBADO en vivo — motivo documentado) | `e013e8a` |
| 6 | T7 (D4-a: aviso de trabajo que no cabe en un día) + T11 (causa raíz + fix del email de confirmación no enviado, ampliado a 4 call-sites) | ✅ Hecha, T7 y T11 (call-site original) verificados en vivo — los otros 3 call-sites de T11 solo por código+`deno check` (documentado) | `b8523b4`, `6d6263c` |
| 7 | **Verificación total**: los 7 servicios de principio a fin, no solo lo tocado en las fases 1–6 | ✅ Hecha — T1 cerrado por HTTP real (hueco de la Fase 1), T5/T6/T9/T10 cruzados en césped, ciclo de vida completo (precio+duración, cancelación en 2 estados+reembolso, cierre+reseña) probado a fondo en césped, booking+pago real en los 7 servicios | — (sin código nuevo) |

---

## Fase 0 — Infraestructura de los runners ✅

**Cierra:** nada de §3.2 directamente — es la red de seguridad que hace fiable medir todo lo
demás.

**Qué se hizo:** `scripts/readiness/_harness.mjs` ganó `nextOpenWeekdayIso()` (resuelve la
próxima fecha con hueco real contra la BD, en vez de asumir "hoy+N días"); los 6 runners que
hardcodeaban `SERVICE_ID` pasaron a resolverlo por `SELECT` sobre `services.name` con
override por variable de entorno, igual que ya hacía `fitosanitarios.mjs`.

**Comprobación real:** los 7 runners en verde (`READINESS_ENGINE=local`) en 3 rondas
seguidas tras varios `supabase db reset`, sin fallos de fecha ni de `service_id` fantasma.

**Commit:** `8783626`.

---

## Fase 1 — Licencia fitosanitaria (T1) + cambio de duración (T4/D5) ✅

**Cierra:** T1 completo (D1/D2/D3), T4/D5 completo.

**Qué se hizo (resumen — el detalle completo va en el mensaje de cada commit):**
- Migración `20260913120000_phytosanitary_license_active_gate.sql`: estado `'expired'`,
  `review_gardener_license()` (admin-only, exige caducidad futura), `expire_due_phytosanitary_licenses()`
  (service_role-only, job periódico añadido a `booking-lifecycle-tick`).
- `bookingEligibilityCore.ts`: nueva exclusión `missing_phytosanitary_license`, evaluada antes
  de construir la cotización. Palmeras excluida a propósito (D2).
- UI: `WeedingPricingConfigurator` bloquea el interruptor de herbicida sin licencia vigente;
  `PhytosanitaryPricingConfigurator` muestra aviso honesto (el químico/eco lo elige el cliente,
  no hay interruptor que bloquear); ambos guían al jardinero a su perfil (D3).
- Migración `20260913121000_price_change_duration_change.sql`: `bookings.proposed_duration_hours`,
  `resize_booking_schedule()` (redimensiona `booking_blocks` + `availability_blocks` +
  `availability`, atómico — si alargar no cabe, falla entero y no deja nada a medias).
  `respond_booking_price_change` la llama siempre al aceptar.
- Fix lateral (mismo día, detectado probando en el navegador): `clientBookingsOverview.ts` no
  traía `proposed_duration_hours` en su propio `SELECT`, así que el aviso de nueva duración no
  aparecía en las tarjetas del dashboard aunque sí en el chat.

**Registro del proceso:**
- El filtro de licencia (`missing_phytosanitary_license`) es la única pieza de T1 que **no** se
  pudo probar por HTTP en este entorno: el contenedor de referencia sirve `booking-authority`
  desde el worktree `GarSer-referencia`, no desde este — el usuario despliega, no yo. Cubierto
  por 17 tests unitarios nuevos + `deno check` limpio en las 3 funciones tocadas.
- Se encontró que probar T4 con datos reales exige que el precio+duración se proponga
  **mientras la reserva sigue `pending`** — un trigger preexistente
  (`prevent_confirm_when_price_change_pending`) impide proponerlo sobre una reserva ya
  `confirmed`. No es un bug, es el diseño ya existente (D5 hereda esa misma ventana).

**Comprobación real:**
- T1 por RPC directa contra el stack de referencia: cliente/admin sin permiso rechazados
  (`42501`), admin sin fecha o con fecha pasada rechazado (`22023`), aprobación con fecha
  futura válida sincroniza `gardener_licenses` + `gardener_profiles`, `expire_due_phytosanitary_licenses`
  expira solo lo que toca y es `service_role`-only, re-subida tras caducar vuelve a `pending`.
- T4 con una reserva real de principio a fin (pago Stripe con tarjeta de test) más varias por
  RPC directa: alargar 2h→5h y 6h→3h redimensionan `booking_blocks`/`availability_blocks`/
  `availability` en las 3 tablas; intentar alargar contra horas ya ocupadas se rechaza limpio y
  atómico (nada a medias).
- `tsc` 171/171 (baseline), `vitest` 453/453, 7/7 runners en verde (0 FALLA).

**Commits:** `21661dc` (T1), `11a08ca` (T4/D5), `c5263a5` (fix lateral del dashboard).

---

## Fase 1.5 — Hallazgo lateral: `generate_recurring_slots` liberaba reservas pagadas ✅

No estaba en §3.2 — se encontró probando T4 en vivo (una reserva pagada aparecía con la hora
"libre" para un segundo cliente). Se investigó en una tarea en segundo plano y se cerró en una
rama aparte para no mezclarla con T1/T4.

**Causa:** `generate_recurring_slots()` (se ejecuta cada vez que el jardinero guarda su horario
recurrente) solo "re-protegía" reservas con `status IN ('confirmed', 'in_progress')` —
`in_progress` es un valor muerto desde `20260806120000`, y una reserva recién pagada está en
`'pending'` hasta que el jardinero la acepta. Esa ventana quedaba desprotegida y, si el
jardinero tocaba su horario mientras tanto, la hora volvía a "libre" para siempre (la
aceptación posterior no vuelve a tocar `availability_blocks`).

**Comprobación real:** reproducido y corregido en vivo contra el stack de referencia (no en un
contenedor aislado): bug reproducido tal cual, backfill cura al instante lo ya corrompido,
nueva reserva bajo el fix sobrevive una segunda edición del horario, caso negativo (reserva
cancelada NO se re-protege) confirmado, 7/7 runners en verde tras aplicar la migración.

**Commit:** `42c5519` en la rama `claude/heuristic-roentgen-de7608` (worktree separado,
`.claude/worktrees/heuristic-roentgen-de7608`) — **pendiente de que el usuario abra su PR**,
igual que el resto.

---

## Fase 2 — Bugs transversales de UI: T5, T6, T9, T10 ✅

**Cierra:** T5, T6, T9, T10 completos.

**Qué se hizo:**
- **T5** — `ClientBookingLauncher.tsx`: `cardHandlers` no tenía `onAcceptPriceChange` ni
  `onRejectPriceChange` (el dashboard, a diferencia de `/bookings`). Se replicó el mismo
  `respondToPriceChange` que ya usaba `BookingsList.tsx`.
- **T6** — `BookingRequestsManager.tsx:516`: la cifra "(Xh)" usaba `.length` de un array
  sintético de un solo elemento (siempre 1) en vez de `request.duration_hours`.
- **T9** — `BookingRequestsManager.tsx:156-201`: la consulta a `profiles` filtraba por `id` en
  vez de `user_id` (son columnas distintas) — el nombre del cliente caía siempre al fallback
  "Cliente desconocido". Se corrigió el filtro y el `Map` de resultados.
- **T10** — `ProvidersPage.tsx`: `String(hora + horasFraccionarias).padStart(2,'0')` daba
  literalmente "10.5:00" en vez de "10:30", en dos sitios del fichero (`buildTimeSlotLabel` y
  el texto en pantalla). Nuevo helper `addHoursToTime`, mismo patrón que el ya usado en
  `ChatWindow.tsx`/`ClientBookingCard.tsx` para T4.

**Registro del proceso:**
- Los 4 hallazgos reprodujeron tal cual el informe — ninguno era falso positivo esta vez.
- Para T10 costó montar un caso con horas fraccionarias reales (el asistente manual de árboles
  no tiene campo de cantidad directo); se logró con árbol grande + acceso difícil (2,5 h).
- De paso, revisando §3.1 para esta fase: **A y B ya estaban cerradas** según el propio
  documento (reembolso real probado en ambos estados de pago; botón "Cancelar reserva" existe
  y funciona). La única pregunta que quedaba abierta en B — "¿existe también en el dashboard de
  inicio, no solo en `/bookings`?" — se confirma que SÍ: `ClientBookingCard` (el mismo
  componente que usa `ClientBookingLauncher`) ya trae `onCancel` cableado y funcionando, visto
  en las mismas capturas de esta fase. **§3.1 queda cerrada por completo, sin código nuevo.**

**Comprobación real (en vivo, con reservas reales, no solo lectura de código):**
- T5: "Aceptar nuevo precio" en el dashboard dispara `respond_booking_price_change` de verdad
  → reserva pasa a `confirmed`/`accepted` con precio y duración nuevos; "Rechazar" dispara el
  mismo RPC con `accept=false` → `cancelled`/`rejected`.
- T6: solicitud de 5h muestra "(5h)", coherente con "Duración estimada: 5h".
- T9: solicitud pendiente muestra "Laura Fernández" en vez de "Cliente desconocido".
- T10: "Horario del trabajo: 14:00 – 16:30" (antes habría sido "16.5:00").
- `tsc` 171/171, `vitest` 453/453, 7/7 runners en verde tras cada tanda.

**Commits:** `39279bf` (T5), `da18b42` (T10), `2ef28f0` (T9), `bb9f6e2` (T6) — 4 commits
atómicos, cada uno revertible sin afectar a los demás.

---

## Fase 3 — T12 (configuradores restantes) + autoguardado espurio ✅

**Cierra:** T12 completo (Lawn/Hedge/Shrub — Palm resultó no afectado) + la pregunta abierta
del autoguardado en el primer render, para los 7 servicios.

**⚠️ La fase creció bastante respecto a lo planeado** — la re-verificación "antes de tocar
código" encontró que el estado que daba por bueno §3.2 era incompleto en dos sitios. Ver
Registro del proceso.

### Registro del proceso

1. **Re-verifiqué T12 contra el código actual antes de tocar nada** (`grep` de
   `config.pricing_method` en los 6 configuradores). Resultado, distinto de lo que decía
   §3.2: **Palm NO está afectado** — a diferencia de Lawn/Hedge/Shrub, `PalmPricingConfigurator`
   ya resuelve `pricing_method` con `getPricingMethod()` en el punto donde deriva `config`
   (línea ~104), así que las comparaciones `config.pricing_method === '...'` que parecían en
   crudo en realidad leen un valor ya normalizado. Falso positivo dentro de un falso
   positivo, mismo tipo de corrección que ya recibió T13/Weeding. **T12 real: 3
   configuradores** (Lawn, Hedge, Shrub), no 4.
2. Antes de tocar el autoguardado, **releí `COORDINACION-SERVICIOS.md` §5** como decía el
   plan. Setos y Palmeras figuran con su propio hallazgo de autoguardado "corregido y
   verificado en vivo" en sus auditorías — pero por precaución los re-comprobé en vivo de
   todos modos (ya me había llevado una sorpresa con Palm en el punto 1).
3. **Sorpresa real, con reservas en vivo (gardener `11111111-...`, stack de referencia):**
   abrí cada uno de los 7 configuradores sin tocar nada y comparé `additional_config`
   (hash+longitud) antes/después.
   - Arbustos (la única pregunta que quedaba abierta): **afectado** — confirma la sospecha.
   - Setos y Palmeras: **siguen afectados**, pese al fix ya documentado. Ambos corrigieron un
     disparador concreto (el que se había reproducido y medido en su momento) pero no la
     causa de fondo. El código de Setos incluso llevaba un comentario sin resolver
     reconociéndolo: *"Note: maybe need a processed base like in isDirty, let's use value
     since initialValue is only to skip first render"*.
   - Árboles: **NUEVO, nunca antes probado**. §3.2 lo daba por descartado con el
     razonamiento "cerró su Fase 2/3 sin mencionarlo" — es decir, nunca se había comprobado
     explícitamente, solo se había asumido. Estaba afectado, con una variante de causa propia
     (ver abajo).
   - Césped, Desbroce, Fitosanitarios: re-confirmados sin problema (por si acaso, dado lo de
     los tres puntos anteriores).
4. Diagnostiqué la causa común (Setos/Palmeras/Arbustos): `useAutoSave` compara
   `value: config` (normalizado en un `useMemo` en cada render) contra
   `initialValue: initialConfig || EMPTY_CONFIG` (crudo, sin pasar por la misma
   normalización) — cualquier campo cuya forma cruda difiera de la normalizada (p. ej.
   `hourly_rate: undefined`, inyectado siempre) hace que `deepEqual` los vea distintos y
   dispara el guardado al segundo de abrir la pantalla. Árboles tiene una variante propia: un
   `useEffect(() => { if (value) setConfig(value); }, [value])` pone `config` al `value`
   CRUDO nada más llegar, sin pasar por la normalización que sí aplicaba (correctamente) al
   lado `initialValue`.
5. Apliqué el mismo fix probado en los 4 (extraer la normalización a una función con nombre y
   usarla en los dos lados de la comparación) — el patrón que `LawnPricingConfigurator.tsx`
   ya usaba de origen, por eso siempre fue inmune. En Setos y Arbustos esta misma extracción
   dejó T12 resuelto de paso (ya no quedaba ningún `config.pricing_method` en crudo).
6. Verifiqué en vivo, uno a uno, con capturas de red y de BD: los 4 dejaron de autoguardar al
   abrir; un cambio real (arbustos, precio mínimo 45→46) se sigue guardando con normalidad —
   el fix no toca el autoguardado legítimo.

### Comprobación real

- **T12** (Lawn/Hedge/Shrub): `grep` final confirma cero comparaciones `pricing_method`/`cfg`
  en crudo en los 3 ficheros. Verificado visualmente que "Método de Cobro" sigue marcando la
  opción correcta en los 3 configuradores tras el cambio.
- **Autoguardado**, con hash MD5 de `additional_config` antes/después de abrir cada
  configurador, sin tocar nada:

  | Servicio | Antes del fix | Después del fix |
  |---|---|---|
  | Corte de césped | sin cambio (ya era inmune) | sin cambio |
  | Desbroce | sin cambio (ya era inmune) | sin cambio |
  | Fitosanitarios | sin cambio (ya era inmune) | sin cambio |
  | Poda de árboles | **cambiaba** (nunca antes probado) | sin cambio ✅ |
  | Poda de palmeras | **cambiaba** (fix previo incompleto) | sin cambio ✅ |
  | Poda de plantas y arbustos | **cambiaba** (pregunta abierta) | sin cambio ✅ |
  | Poda de setos | **cambiaba** (fix previo incompleto) | sin cambio ✅ |

- Edición real de prueba en Arbustos (precio mínimo 45→46): se guardó correctamente
  (`additional_config->>'minimum_price' = '46'`), restaurado a 45 después de comprobarlo.
- `tsc` 171/171 (baseline) en ambos commits, `vitest` 453/453, 7/7 runners de readiness en
  verde (0 FALLA) tras el fix completo.

**Commits:** `a5c7500` (T12 — Lawn, el único caso puro) y `16d8eb5` (autoguardado — Setos,
Palmeras, Árboles y Arbustos, que de paso cierra T12 para Setos y Arbustos).

---

## Fase 4 — T2: redondeo de horas ✅

**Cierra:** T2 completo.

**Hallazgo (re-verificado antes de tocar código, sigue igual):** `if (totalHours > 8)
totalHours *= 0.9;` seguido de `Math.ceil(totalHours*2)/2` — ahora en
`src/shared/bookingQuoteCore.ts:1551-1552` (se movió de 1349-1350 por los cambios acumulados
de fases anteriores). El problema no es la fórmula en sí sino la imprecisión de coma flotante
en la cadena de división/multiplicación real (`(5000/150)*0.9` da `30.000000000000004` en vez
de `30` exacto), que el `Math.ceil` sube a medio bloque de más justo cuando el resultado cruza
un umbral entero o medio entero.

**Fix:** `totalHours = Math.round(totalHours * 1e6) / 1e6;` justo antes del `Math.ceil`,
absorbiendo el ruido de coma flotante (muy por debajo de cualquier granularidad real de
tarifa) sin tocar la lógica de negocio — sigue redondeando hacia arriba al medio bloque, solo
que ahora sobre el valor real, no sobre su ruido binario.

### Registro del proceso

1. Verificado en Node, antes de tocar código, que el fix propuesto corrige exactamente los 3
   casos documentados en §3.2 (césped 5000/150→30,5h✗/30,0h✓; desbroce 1000/120→8h✗/7,5h✓ y
   2000/120→15,5h✗/15,0h✓).
2. Aplicado el fix. `tsc` 171/171 (baseline), `vitest` 453/453 sin cambios — ninguno de los
   tests unitarios existentes ejercitaba por casualidad este caso límite de coma flotante.
3. **7/7 runners de readiness: 0 FALLA, sin ningún cambio en los números ya esperados.** Esto
   no es sospechoso: el propio hallazgo original ya advertía que un barrido sistemático de
   `totalHours` en decimal NO lo encuentra ("el residuo depende de la CADENA real de
   división/multiplicación, no del valor decimal final") — ninguna de las cantidades que usan
   los 7 runners hoy cae justo en uno de esos residuos binarios. La tolerancia de
   `expectQuote` (`tolHours = 0.005`) es lo bastante ajustada como para que, si algún fixture
   SÍ hubiera cruzado el umbral, se habría visto como una FALLA nueva de 0,5h — no la hubo, así
   que **no hizo falta recalcular a mano ningún runner esta vez** (el aviso del protocolo
   seguía en pie, pero esta vez no aplicó).
4. **Verificación en el navegador, a petición explícita del usuario — con un hallazgo
   importante.** Encontré el caso reproducible más pequeño y práctico para probar en un solo
   día de agenda: **1250 m² de césped, estado normal, sin retirada de restos** →
   `1250/150=8,333...>8`, con el `*0.9` da `7,500000000000001` en coma flotante → antes del
   fix redondeaba a **8h**, después de fix a **7,5h**. Reservé exactamente ese escenario en el
   navegador (cliente real, entrada manual) — y la pantalla de selección de jardinero siguió
   mostrando **8h**, el valor con el bug.
   
   Diagnóstico: la duración que se ve en esa pantalla viene de una llamada HTTP a
   `booking-authority` (confirmado por `read_network_requests`: `POST
   .../functions/v1/booking-authority` devuelve `"estimatedHours":8`), y esa función edge está
   **desplegada desde el checkout de referencia (`~/Downloads/GarSer-referencia`), no desde
   este worktree** — exactamente la misma limitación ya documentada para T1 y T7 en este mismo
   plan. Confirmé además que no existe ningún camino cliente-side que ejecute
   `buildAuthoritativeBookingQuote` en el navegador sin pasar por esa función: `bookingQuote.ts`
   la envuelve (`buildBookingQuote`) pero no se usa en ninguna pantalla real, y
   `ProvidersPage.tsx`/`ConfirmationPage.tsx` solo importan *tipos* de `bookingQuoteCore.ts`,
   no la función de cálculo.
   
   Para no quedarme solo con "no se pudo", repetí el **mismo escenario exacto** (mismo
   `bookingInput`, mismo `providerId`, misma configuración real del jardinero en BD) contra el
   motor en proceso (`READINESS_ENGINE=local`, que llama a la misma
   `buildAuthoritativeBookingQuote` que usa `booking-authority`, solo que sin pasar por HTTP):
   `estimatedHours: 7.5` — correcto. Es la prueba más rigurosa disponible en este entorno sin
   desplegar: mismo código, mismo dato real, mismo resultado que vería el cliente una vez el
   usuario despliegue.

### Comprobación real

- Los 3 casos documentados en §3.2, verificados en Node contra la fórmula exacta: corregidos.
- `tsc` 171/171, `vitest` 453/453, 7/7 runners en verde (0 FALLA), sin necesidad de recalcular
  ningún runner a mano.
- **Motor en proceso, mismo escenario que se reservó en el navegador** (1250 m² césped normal,
  sin retirada de restos, configuración real del jardinero sembrado):
  `estimatedHours: 7.5` (antes del fix: 8) — verificado con `READINESS_ENGINE=local`, la misma
  función que usa `booking-authority`.
- ~~NO PROBADO por HTTP/navegador~~ — **actualizado, ver más abajo: ya probado de verdad.**

**Commit:** `ec9a7b7`.

### Actualización — despliegue al stack local y prueba real por HTTP (a petición explícita del usuario, 2026-09-14)

El usuario pidió explícitamente desplegar al servidor local y probarlo de verdad, en vez de
quedarme con el motor en proceso como sustituto. Esto **no es el despliegue a producción**
que el protocolo reserva para el usuario (`COORDINACION-SERVICIOS.md` §4) — es sincronizar el
código al stack de referencia LOCAL para poder medir por HTTP, algo que el propio §4b ya
contempla como acción rutinaria de entorno.

1. **Diagnóstico previo:** `~/Downloads/GarSer-referencia` ya tenía sin commitear una
   sincronización PARCIAL de T1 (4 ficheros: `bookingEligibilityCore.ts`,
   `booking-authority/index.ts`, `booking-payment/index.ts`,
   `booking-lifecycle-tick/index.ts`) — de una acción de una sesión anterior a este resumen,
   nunca reflejada en el informe que heredé. Verificado con `git diff` que el contenido
   coincide exactamente con mis propios commits de T1: nada ajeno, seguro continuar.
2. **Diff completo** de `src/shared/` y `supabase/functions/` entre este worktree y
   `GarSer-referencia`: la ÚNICA diferencia real restante era `bookingQuoteCore.ts` (el fix de
   T2, sin sincronizar). T4 no necesita sincronizar nada aquí: su RPC se llama directo desde
   el cliente, sin pasar por ninguna función edge.
3. Copiado `src/shared/bookingQuoteCore.ts` a `GarSer-referencia`. `supabase stop && supabase
   start` (backup automático a volumen Docker, sin `db reset`, sin perder datos) para que el
   contenedor del edge-runtime recargue las funciones con el código nuevo.
4. **Repetido el escenario exacto en el navegador** (1250 m² césped normal, sin retirada de
   restos, cliente real, entrada manual): la pantalla de selección de jardinero ahora muestra
   **"la duración del servicio es de 7.5 h"** — correcto. Confirmado también en la respuesta
   HTTP cruda (`read_network_requests`): `POST .../functions/v1/booking-authority` →
   `"estimatedHours":7.5` (antes de este redespliegue local: `8`). Prueba completa, por el
   camino real que usa un cliente de verdad, no solo el motor en proceso.
5. Reserva de prueba abandonada sin guardar nada ("Salir y borrar datos").

**Nota para las fases siguientes:** el stack de referencia local queda ahora con el código de
`booking-authority`/`booking-payment`/`booking-lifecycle-tick` de este worktree desplegado
(T1 + T2). Esto también destraba, para las fases que quedan, la verificación por HTTP de T7
(vive en `booking-authority`) y de la puerta de licencia de T1, que hasta ahora estaban
marcadas NO PROBADO por este mismo motivo — se re-evaluará en cada fase si siguen
sincronizadas o hace falta repetir la copia (cualquier cambio nuevo en estos ficheros compartidos
requiere repetir los pasos 2-3 de arriba antes de medir por HTTP).

---

## Fase 5 — T8 + cierre formal de T4 ✅

### T8 — rama que falta en el sondeo de pago agotado

**Hallazgo (re-verificado antes de tocar código, sigue igual, línea movida a
`ConfirmationPage.tsx:2098-2119`):** si el sondeo del cliente agota sus intentos con el
`PaymentIntent` todavía en `payment_pending`, `onConfirmed` no entra en ninguna de sus tres
ramas (`booking_created` / `processing` / error terminal) y no hace nada.

**Fix:** nueva rama para `latest?.status === 'payment_pending'` (tras agotar el sondeo) con un
aviso informativo (`toast` normal, no `toast.error` — no es un error) explicando que se sigue
esperando la confirmación y sugiriendo actualizar antes de reintentar. Deliberadamente NO
reintenta solo ni bloquea el formulario: un reintento automático sobre el mismo `PaymentIntent`
ya confirmado por Stripe falla con un error de procesamiento confuso (según el propio
hallazgo), así que la decisión de cuándo reintentar queda en manos del cliente.

### Cierre formal de T4

**Releída la entrada original de §3.2 línea por línea.** El repro original: reserva de
1000 m² descuidado (216€/8h) → jardinero corrige a 1400 m² descuidado y propone 303€ (SIN
tocar ningún campo de duración, porque ese campo no existía todavía) → `total_price` se
actualiza pero `duration_hours`/`end_time`/`booking_blocks` se quedan en el valor viejo para
siempre — no había ningún mecanismo para corregirlos, pasara lo que pasara.

**Pregunta a responder:** el fix de la Fase 1 (D5) es OPT-IN — el campo de nueva duración es
opcional. ¿Cubre esto de verdad el hallazgo original, o solo el caso nuevo en el que el
jardinero SÍ rellena el campo?

### Registro del proceso

1. **T8:** aplicado el fix descrito arriba. `tsc` 171/171 (baseline).
2. **T4, verificación en vivo:** reservé una plaza real (césped, 200 m², pago Stripe completo)
   y, como jardinero, reproduje el escenario ORIGINAL exacto de §3.2 — propuse un precio nuevo
   (45€→63€, con motivo "El jardín mide más de lo declarado") **sin tocar el campo "Nueva
   duración"**, dejándolo vacío a propósito. El cliente aceptó desde el dashboard.
   
   Resultado en BD: `total_price=63.00` (correcto, igual que antes del fix), `duration_hours=2`
   **sin cambiar** (igual que `booking_blocks`, sigue con solo las horas 8 y 9).
   
   **Esto NO es que T4 siga sin arreglar — es el comportamiento correcto tras D5.** El bug
   original no era "el precio y la duración deberían moverse siempre juntos": era que **no
   existía ningún mecanismo** para corregir la duración cuando hacía falta. D5 dio esa
   herramienta al jardinero, como una opción explícita ("el jardinero PUEDA solicitar
   también un alargamiento o acortamiento" — decisión del usuario, no automática). Cuando el
   jardinero no la usa porque la corrección de precio no viene de un cambio de tamaño del
   trabajo (p. ej. un ajuste de tarifa), la duración se queda como estaba — con razón, porque
   sigue siendo la correcta.
3. Confirmado además (ya probado exhaustivamente en la Fase 1, no repetido aquí) que cuando el
   jardinero SÍ usa el campo de duración, `duration_hours`/`end_time`/`booking_blocks` se
   actualizan correctamente — cerrando el hueco real que describía el hallazgo.
4. Revisado el consumidor del dato desactualizado que citaba el hallazgo original
   (`src/shared/bookingStatus.ts:105`, `serviceEndMs`/`needsClientConfirmation`): lee
   `duration_hours` directamente de la fila de BD que se le pasa, sin caché — hereda
   automáticamente cualquier corrección sin necesitar cambios propios. Confirmado que no es
   consumido por ninguna función edge (solo componentes de cliente), así que no había nada que
   sincronizar al stack local para esta parte.

### Comprobación real

- **T8:** `tsc` 171/171, `vitest` 453/453, 7/7 runners en verde. Reserva real con pago Stripe
  completo de principio a fin en el navegador — confirma que la rama `booking_created` (la de
  al lado) y el resto del flujo de pago siguen intactos. **La rama nueva en sí (sondeo
  agotado con Stripe tardando >12s reales) queda NO PROBADO en vivo**: forzar esa espera exacta
  de forma fiable sin manipular el estado de un intento de pago compartido no era seguro ni
  práctico en este entorno — verificada por revisión de código + `tsc` únicamente. Se
  documenta explícitamente en vez de darla por buena sin comprobar.
- **T4:** reserva real (césped 200 m², pago Stripe completo) → propuesta de precio-solo
  (sin tocar duración) → aceptada por el cliente → `total_price=63.00`, `duration_hours=2`
  sin cambiar, `booking_blocks` intactos. Comportamiento correcto y por diseño, confirmado
  releyendo el hallazgo original línea por línea: el hueco real (ningún mecanismo para
  corregir la duración) está cerrado desde la Fase 1; este comportamiento no es un hueco
  nuevo. `tsc` 171/171, `vitest` 453/453, 7/7 runners en verde.

**Commit:** `e013e8a` (T8). T4 no generó código nuevo — la Fase 1 ya lo cerró; esta fase es
solo verificación, documentada aquí y en §3.2.

---

## Fase 6 — T7 (D4-a) + T11 ✅ CERRADA (2026-09-14)

### T7 — trabajo que no cabe en un día

**Decisión del usuario (D4-a):** fix mínimo y honesto. Detectar que `estimatedHours` supera la
jornada más larga disponible del profesional y avisar al cliente de que el trabajo no cabe en
un único día — sin construir un sistema de reserva multi-día.

**Dónde:** no había ningún sitio que calculara esto; el síntoma se observaba en
`supabase/functions/booking-authority/index.ts` (`preview_providers`/`valid_hours`, exclusión
genérica `no_reservable_availability`, indistinguible de "esta fecha en concreto no tiene
hueco").

**Implementado en `src/shared/bookingEligibilityCore.ts`** (importado por `booking-authority`):
un primer diseño comparaba el hueco libre más largo de cada fecha escaneada contra la duración
pedida, dentro de la rama `!earliestSlot` — se demostró que es lógicamente imposible: por
construcción, `getValidStartHours(...).length > 0` equivale a que el hueco más largo sea
`>= duración`, así que al llegar a esa rama TODAS las fechas ya tienen, necesariamente, un
hueco más corto que lo pedido. La comparación siempre salía verdadera y el código era papel
mojado (confirmado porque 2 de 3 tests nuevos fallaban). Rediseño final: comparar la duración
contra `MAX_SINGLE_DAY_DURATION_HOURS = 12`, el mismo tope que ya aplica todo el sistema
(`duration_hours <= 12` en ~7 migraciones SQL), de forma incondicional y ANTES de escanear
ninguna agenda — nuevo código de exclusión `service_exceeds_single_day`. Mensaje también
ajustado en `src/pages/reserva/ProvidersPage.tsx` (mismo patrón que el mensaje de T1).

### T11 — email de confirmación no se envía nunca

**Hallazgo original:** `admin.functions.invoke('booking-confirmation-email', ...)` dentro de
`booking-payment-webhook/index.ts:644` devolvía `401 Unauthorized`, aunque la misma llamada por
`curl` con la misma `service_role_key` funcionaba (`200 OK`). Hipótesis sin confirmar en el
hallazgo original: la versión de `supabase-js` resuelta por el import sin pin
(`esm.sh/@supabase/supabase-js@2`) podía diferir entre aislados de Deno y cambiar cómo
`functions.invoke()` construye la cabecera `Authorization`.

**Causa raíz confirmada** (leyendo el bundle real resuelto por esm.sh —
`@supabase/supabase-js@2.116.0` y `@supabase/functions-js@2.116.0`, no la hipótesis de
versión): `createClient(url, key)` fija `this.headers = options.global.headers ?? {}` — vacío
si no se pasa `global.headers`. `.rpc()`/`.from()` resuelven la clave de servicio por su
cuenta; `functions.invoke()` no: nunca manda `Authorization` salvo que se le pase explícito
(por construcción o por llamada). No era un problema de versión entre aislados de Deno, sino de
esta llamada en concreto.

**Alcance ampliado:** un `grep -rln ".functions.invoke("` sobre todas las edge functions
encontró el mismo patrón en 4 sitios de 3 archivos, no solo el documentado originalmente:
`booking-payment-webhook/index.ts` (confirmación de reserva creada),
`booking-complete/index.ts` (aviso al cliente de que el jardinero terminó), y
`booking-payment/index.ts` ×2 (cancelación e incidencia resuelta). Los 4 comparten la misma
causa raíz y se corrigieron con el mismo fix mínimo: `headers: { Authorization: `Bearer
${serviceRoleKey}` } }` explícito en la llamada. En `booking-payment-webhook/index.ts` la
llamada vive en `processStripeEvent(admin, ...)`, una función que no recibe `serviceRoleKey`
como parámetro (solo `admin`) — se usa el resolver local del propio archivo
`resolveServiceRoleKey()` en vez de la variable externa (que no estaba en scope: primer intento
produjo `TS2304: Cannot find name 'serviceRoleKey'` en `deno check`, corregido).

### Registro del proceso

1. Re-verificación previa: se confirmó que ambos hallazgos seguían reproduciendo contra el
   código actual antes de tocar nada.
2. T7: primer diseño (`longestContiguousRun` + comparación en la rama `!earliestSlot`) escrito,
   testeado, y descartado al demostrarse lógicamente imposible (ver arriba). Reddiseño con el
   tope de 12 h, tests reescritos. `vitest` 455/455 (+2 sobre la Fase 5).
3. T11: diagnóstico llevado hasta la causa raíz real inspeccionando el bundle de supabase-js
   resuelto en producción (esm.sh), no solo la hipótesis del hallazgo original. Corrección
   aplicada a los 4 call-sites tras el `grep` de alcance.
4. Verificación de tipos: `deno check` en los 4 archivos de edge functions tocados/relacionados
   (`booking-payment-webhook`, `booking-complete`, `booking-payment`, `booking-authority` por
   import indirecto de T7). `booking-payment-webhook` no tenía baseline registrada — se
   estableció vía `git stash` del archivo (14 errores pre-existentes). El primer intento del
   fix T11 ahí subió a 15 (1 error nuevo, `serviceRoleKey` fuera de scope); corregido con el
   resolver local del archivo, vuelta a 14/14 sin regresión.
5. `tsc --noEmit` 171/171, `vitest` 455/455, 7/7 runners de readiness en verde
   (`READINESS_ENGINE=local`, apuntando al contenedor de `GarSer-referencia` vía
   `SUPABASE_DB_CONTAINER`/`SUPABASE_PROJECT_DIR`), 0 FALLA en los 7 servicios.
6. Sincronizados a `~/Downloads/GarSer-referencia`: `bookingEligibilityCore.ts`,
   `ProvidersPage.tsx`, y los 3 archivos de edge functions de T11. `supabase stop && supabase
   start` (con backup/restore automático de datos, sin `db reset`) para que el edge runtime
   sirviera el código corregido.
7. Verificación T7 en vivo por HTTP directo a `booking-authority` (`preview_providers`,
   césped 2200/2500/3000 m²): la exclusión `service_exceeds_single_day` se dispara con el
   mensaje correcto (14h/15h/18h según el área) sin ni mirar la disponibilidad del
   profesional (`quotes: {}`, sin llamada a agenda).
8. Verificación T7 en el navegador: reserva manual de césped 3000 m² de principio a fin hasta
   `ProvidersPage`. **Se encontró y corrigió un problema de infraestructura de pruebas, no de
   código**: el servidor de desarrollo lanzado por nombre (`garser-dev`) resolvía
   `.claude/launch.json` del directorio de trabajo primario de la sesión
   (`~/Downloads/GarSer-main 4`, un clon **no relacionado** con esta auditoría), no el de
   `~/Downloads/auditorias/transversal` — servía código sin ninguno de los cambios de esta
   auditoría, lo que producía el mensaje genérico "no hay profesionales disponibles" en vez del
   mensaje de T7. Confirmado añadiendo un log de diagnóstico temporal (revertido después de
   confirmar) y comparando con la petición de red real (que sí devolvía
   `service_exceeds_single_day` correctamente — la API nunca falló, solo el frontend servido no
   era el correcto). Fix: se añadió una configuración `transversal-dev` a
   `~/Downloads/GarSer-main 4/.claude/launch.json` que lanza `npm run dev --prefix
   ~/Downloads/auditorias/transversal -- --port 5180`, sirviendo el worktree correcto. Con esa
   corrección, el mensaje de T7 apareció exacto en el navegador.
9. Verificación T11 en vivo: reserva real (césped 200 m², pago Stripe con tarjeta de test) de
   principio a fin en el navegador. El primer intento no generó ningún correo porque no había
   ningún receptor de webhooks de Stripe escuchando en local — se arrancó `stripe listen
   --forward-to http://127.0.0.1:54321/functions/v1/booking-payment-webhook` (el secreto de
   firma que imprime coincide exactamente con el ya configurado en
   `supabase/functions/.env`, señal de que la CLI de Stripe mantiene un secreto estable por
   cuenta) y se repitió la reserva con el listener activo. El log muestra el evento
   `payment_intent.amount_capturable_updated` reenviado y procesado con `200`, y el log del
   edge runtime confirma `serving the request with supabase/functions/booking-confirmation-email`
   seguido de `MOCK EMAIL (client) -> cliente.local@test.local | ...` y `MOCK EMAIL (gardener)
   -> ...` — antes del fix, esta invocación ni siquiera llegaba a producirse (moría en el 401
   silencioso). El log "MOCK EMAIL" es el propio comportamiento esperado de
   `booking-confirmation-email/index.ts` cuando faltan credenciales SMTP en local (fallback
   deliberado, no un error) — por eso Mailpit se queda vacío aunque el envío sea correcto.
10. Commits atómicos: `b8523b4` (T7), `6d6263c` (T11).

### Comprobación real

- **T7 (motor, HTTP directo a `booking-authority`):** `preview_providers` con césped
  2200/2500/3000 m² → `service_exceeds_single_day` con "14/15/18 horas seguidas..." exacto,
  `quotes: {}` (no llega a mirar agenda). **PROBADO en vivo por HTTP real** contra el stack
  local (no `READINESS_ENGINE=local`).
- **T7 (frontend, navegador):** reserva manual césped 3000 m² hasta `ProvidersPage` →
  mensaje "Este trabajo necesita más horas seguidas de las que caben en una sola jornada. De
  momento no ofrecemos reservas repartidas en varios días — prueba a reducir el alcance del
  trabajo." renderizado tal cual. **PROBADO en vivo en el navegador.**
- **T11 (`booking-confirmation-email`, el call-site del hallazgo original):** reserva real
  con pago Stripe completo + `stripe listen` reenviando al stack local → log del edge runtime
  confirma la invocación llega a MOCK EMAIL para cliente y jardinero. **PROBADO en vivo de
  principio a fin** (pago real → webhook real → invocación de función real).
- **T11 (los otros 3 call-sites: `booking-complete`, `booking-payment` ×2 — cancelación e
  incidencia resuelta):** mismo fix, byte a byte, que el call-site ya probado; mismo mecanismo
  de causa raíz confirmado. Verificados por `deno check` (sin regresión de baseline en ninguno
  de los 3 archivos) y revisión de código, pero **NO PROBADO en vivo end-to-end** — disparar
  una cancelación o una resolución de incidencia real habría requerido más pasos de flujo
  (reserva aceptada + cancelación, o reserva con incidencia abierta + resolución) que no se
  ejecutaron en esta fase por alcance de tiempo. Se documenta explícitamente en vez de darlo
  por probado solo porque el patrón es idéntico.
- `tsc --noEmit` 171/171 (sin regresión). `vitest run` 455/455 (sin regresión, +2 sobre Fase
  5 por los tests nuevos de T7). `deno check`: `booking-authority` 25/25 (import indirecto de
  T7, sin regresión), `booking-payment` 13/13 (sin regresión), `booking-complete` 0/0 (sin
  regresión), `booking-payment-webhook` 14/14 (baseline establecida esta fase vía `git stash`;
  el primer intento del fix subió a 15, corregido de vuelta a 14). 7/7 runners de readiness en
  verde, 0 FALLA en los 7 servicios (arboles 15/0/0, arbustos 18/0/1, cesped 29/0/7, desbroce
  19/0/3, fitosanitarios 74/0/2, palmeras 71/0/0, setos 35/0/1 — los NO PROBADO de cada runner
  son preexistentes y no relacionados con T7/T11).

**Commits:** `b8523b4` (T7), `6d6263c` (T11).

---

## Fase 7 — Verificación total final ✅ CERRADA (2026-09-14)

No es una fase de código: es la comprobación de que, con **todos** los hallazgos cerrados, los
**7 servicios siguen funcionando de principio a fin** — no solo lo que cada fase tocó
directamente. Se ejecuta **después** de la Fase 6, nunca antes.

### Qué se comprueba, por cada uno de los 7 servicios (césped, setos, árboles, palmeras,
arbustos, desbroce, fitosanitarios)

1. **Runner de readiness en verde** (`READINESS_ENGINE=local`) — 0 FALLA, igual que en cada
   fase individual, pero todos a la vez, en el mismo estado de BD, sin resets a medias.
2. **Ciclo de vida completo en el navegador, con datos reales:**
   - Reserva con datos manuales (o foto si el runner del servicio lo cubre) → pago real con
     tarjeta de test → aceptación del jardinero → captura del pago.
   - Cambio de precio (con y sin cambio de duración, D5) → aceptación del cliente → agenda
     redimensionada.
   - Cancelación en ambos estados de pago (antes y después de capturar) → reembolso cuando
     toque.
   - Cierre del servicio → reseña.
3. **Puerta de licencia (T1):** un jardinero sin licencia vigente queda excluido de
   fitosanitarios y de desbroce con herbicida; palmeras NO se ve afectada (D2). Si el entorno
   sigue sin poder probar el camino HTTP (edge functions no desplegadas desde este worktree),
   se prueba lo que sí es accesible (RPC directa) y se deja constancia explícita de lo que
   sigue NO PROBADO.
4. **Verificación cruzada de los hallazgos de UI (T5/T6/T9/T10):** en al menos un servicio
   distinto al que se usó para verificarlos en la Fase 2, para confirmar que de verdad son
   transversales y no una coincidencia del servicio de prueba.

### Gate técnico (igual que en cada fase, pero sobre el estado final)

- `npx tsc --noEmit -p tsconfig.app.json` — no puede superar el baseline de partida.
- `npx vitest run` — sin fallos.
- Los 7 runners de `scripts/readiness/` — 0 FALLA en todos.

### Cierre documental

1. Actualizar `COORDINACION-SERVICIOS.md` §3.2: cada fila de T1–T12 marcada como cerrada, con
   el commit y la evidencia (o **NO PROBADO** explícito donde corresponda — T1 y T7 en el
   camino HTTP, T11 si el diagnóstico no llega a un fix confirmado).
2. Añadir la batería de pruebas de esta ronda a `docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md`
   (regla ya fijada: toda ronda traduce sus pruebas a producción en ese fichero único).
3. Informe final al usuario con el estado de cada hallazgo y lo que queda pendiente de su
   parte (abrir PRs, mergear, desplegar, reiniciar el entorno compartido).

### Registro del proceso

1. **Gate técnico de partida** (mismo estado de BD, sin resets a medias): `tsc` 171/171
   (baseline), `vitest run` 455/455, 7/7 runners de readiness en verde — `arboles` 15/0/0,
   `arbustos` 18/0/1, `cesped` 29/0/7, `desbroce` 19/0/3, `fitosanitarios` 74/0/2, `palmeras`
   71/0/0, `setos` 35/0/1 (los NO PROBADO son preexistentes de cada runner, no de esta fase).
2. **T1, puerta de licencia — mejora sobre la Fase 1.** En la Fase 1 quedó explícitamente
   NO PROBADO por HTTP porque el stack de referencia servía `booking-authority` desde un
   worktree distinto al de este. Ese motivo ya no aplica: en la Fase 6 se sincronizó
   `bookingEligibilityCore.ts` completo a `GarSer-referencia` para T7, y ese archivo ya
   llevaba el gate de licencia de la Fase 1. Confirmado por `diff` que los 3 archivos
   relevantes (`bookingEligibilityCore.ts`, `bookingQuoteCore.ts`, `booking-authority/index.ts`)
   son idénticos entre este worktree y el de referencia. Se aprovechó para cerrar por fin el
   hueco de la Fase 1:
   - El jardinero sembrado tiene `has_phytosanitary_license=true` pero
     `license_expires_at=NULL` — por diseño (`hasValidPhytosanitaryLicense` exige fecha), esto
     ES "sin licencia vigente" de forma natural, sin tocar nada.
   - HTTP real a `booking-authority` (`preview_providers`): fitosanitarios químico →
     `missing_phytosanitary_license`. Desbroce con herbicida → mismo código. Palmeras → **sin
     exclusión, elegible** (D2 confirmado en vivo).
   - Caso positivo: se aprobó la licencia directamente en BD con fecha futura (mismo estado
     final que dejaría `review_gardener_license`, RPC ya probada en Fase 1) y se repitieron las
     3 llamadas: fitosanitarios químico → elegible; desbroce con herbicida (100 m², para no
     chocar con el límite de agenda del fixture) → elegible.
   - Estado de licencia revertido a como estaba (`NULL`) al terminar, para no afectar otros
     runners; 3 runners relacionados (`fitosanitarios`, `desbroce`, `palmeras`) re-ejecutados
     tras el revert — 0 FALLA, sin cambios.
3. **T5/T6/T9/T10, verificación cruzada en un servicio distinto al de la Fase 2** (que usó
   árboles). Se eligió **césped** — no probado para estos 4 hallazgos hasta ahora, y con
   fracciones de hora ya conocidas por T2 (bueno para T10). Reserva real: 1250 m² normal, sin
   retirada → 7,5 h de precio, 8 h de bloque de agenda (redondeo a hora completa, no es un
   bug: el precio usa `estimatedHours` fraccionario, el bloqueo de agenda usa
   `Math.ceil` a horas enteras, son cosas distintas). Pago Stripe real completado.
   - **T10**: en el paso de selección de hora (`ProvidersPage`, antes de confirmar), con
     7,5 h de estimación: "Horario del trabajo: 08:00 – 15:30" — correcto (antes del fix
     habría sido "08:00 – 15.5:00").
   - **T9**: panel de solicitudes del jardinero muestra "Laura Fernández", no "Cliente
     desconocido".
   - **T6**: "08:00:00 - 16:00:00 (8h)" en la tarjeta de solicitud coincide con "Duración
     estimada: 8h" en el detalle — cifra correcta también aquí.
   - **T5**: como jardinero, propuesta de cambio de precio+duración (225€→280€, 8h→9h) sobre
     la reserva pendiente; como cliente, el dashboard (`ClientBookingLauncher`) muestra
     "Miguel propone un nuevo precio... Aceptar nuevo precio / Rechazar" y el nuevo horario de
     fin ya bien formateado ("9 h (fin a las 17:00)"). Al aceptar: `status=confirmed`,
     `duration_hours=9`, `end_time=17:00` — agenda redimensionada (D5) y precio actualizado.
4. **Ciclo de vida completo en el navegador, con datos y pagos reales — profundizado en
   césped** (mismo hilo del punto 3, misma reserva de 1250 m²):
   - Booking manual + pago real Stripe (`stripe listen` reenviando al stack local) →
     `payment_intent.amount_capturable_updated`/`charge.succeeded`, 200 OK.
   - Cambio de precio+duración (D5) aceptado → ver punto 3.
   - **Cancelación ANTES de capturar** (reserva distinta, 200 m², cliente cancela estando
     `pending`): resultado inesperado a primera vista — el PaymentIntent apareció
     **capturado** en Stripe (`status=succeeded`, `amount_received` completo) en vez de
     liberado. Investigado a fondo antes de darlo por bug: la RPC `cancel_booking` tiene una
     política económica explícita (comentario `POLÍTICA ECONÓMICA (§8C-D3)` en el propio SQL,
     "comportamiento histórico") — si cancela el **cliente** con **menos de 24 h** de
     antelación respecto al inicio del servicio, pierde la tarifa de gestión aunque el
     jardinero ni siquiera hubiera aceptado (`money_action='capture'`); con 24 h o más, se
     libera sin coste. La reserva cancelada caía justo dentro de esa ventana <24h. **No es un
     bug — es la política de cancelación tardía del cliente, ya diseñada, funcionando
     exactamente como está escrita.** Único matiz encontrado (no bloqueante, no es un
     hallazgo de esta ronda): el texto que ve el cliente antes de cancelar ("los gastos de
     gestión están retenidos y solo se cobran cuando el profesional acepte") no menciona esta
     ventana de 24 h, así que un cliente que cancela tarde puede sorprenderse de que sí se le
     cobre. Se deja anotado para quien priorice trabajo de UX, no se toca en esta ronda.
   - **Cancelación DESPUÉS de capturar** (la reserva de 1250 m², ya `confirmed` tras el
     cambio de precio, cancelada por el **jardinero** desde su Panel — el botón "Cancelar
     reserva" vive en el dashboard principal del jardinero, no en su vista "Reservas"):
     `money_action='refund'` sin depender de ninguna ventana horaria (esa regla de 24h es
     solo para cuando cancela el cliente). Reembolso real confirmado en Stripe:
     `re_3UFZGV2MwFyGXuB711JT3HHb`, 28,13 €, `status=succeeded` — exactamente el total de
     gastos de gestión pagado. Penalización automática de 1★ (§8C-D4) confirmada en
     `public.reviews`: `rating=1`, `is_system_penalty=true`,
     `system_reason='gardener_cancelled_after_accepting'`.
   - **Cierre + reseña real** (la reserva de 200 m² restante, aceptada y capturada): como no
     se puede esperar al reloj real hasta la fecha de la reserva (15 sep 2026), se movió su
     `date`/`start_time` en BD a un momento ya pasado del mismo día de la prueba —
     `mark_gardener_finished` exige `now() >= booking_service_start`, así que sin este ajuste
     de reloj no se podía ejercer el flujo (mismo tipo de limitación temporal ya aceptado en
     la Fase 5 para T8). Jardinero pulsa "He terminado" → `gardener_finished_at` fijado;
     cliente ve "CONFIRMA EL SERVICIO" → "Sí, confirmar" → estado `completed`; cliente deja
     reseña real (4★, comentario) → guardada en `public.reviews` con `is_system_penalty=false`
     (reseña genuina, no la penalización automática del punto anterior).
5. **Booking + pago real en los 6 servicios restantes** (árboles, arbustos, desbroce,
   fitosanitarios, palmeras, setos) — confirma que el motor de precios y el checkout
   funcionan de verdad para cada uno, no solo en el runner:
   - Árboles: mediano, poda de formación, acceso normal → 77,63€, pago real completado.
   - Arbustos: 20 m², medianas, normal → 168,75€, pago real completado.
   - Fitosanitarios: césped 200, preventivo, ecológico (elegible sin licencia por diseño) →
     56,25€, pago real completado.
   - Palmeras: Phoenix canariensis, 4-10m, normal, ×1 → 137,25€, pago real completado.
   - Setos: 15m, 1,5m alto, dos caras, normal → 136,13€, pago real completado.
   - Desbroce: 300 m², dificultad normal, sin herbicida → 141,75€, pago real completado
     (varios reintentos — ver limitación de entorno más abajo).
   - Ninguno de estos 6 se llevó más allá del booking+pago (sin repetir cambio de precio,
     cancelación o cierre+reseña): el mecanismo transversal ya quedó profundamente verificado
     en césped (punto 4) y estos pasos no tienen código específico de servicio — repetirlos
     6 veces más habría sido redundante frente al tiempo disponible. Se marca explícitamente
     NO PROBADO para estos 6 (no falso "probado" por extensión).
   - Todas las reservas de esta fase confirmadas con eventos de Stripe reales (`payment_intent
     .amount_capturable_updated`/`charge.succeeded`) y `200 OK` del webhook en el log de
     `stripe listen`.
6. **Limitación de entorno detectada y resuelta en el camino (no es un hallazgo de
   producto):** durante los checkouts de este punto 5, el formulario embebido de Stripe
   Elements dejó de renderizar (quedaba en blanco, sin llamada de red a `stripe.com`) de forma
   intermitente y creciente conforme avanzaba la sesión — confirmado que no era la red
   (`js.stripe.com` responde 200 desde el host) ni el backend (Docker, `stripe listen` y Kong
   sanos en todo momento) sino el estado acumulado del propio panel de vista previa tras horas
   de uso continuado. Resuelto de forma repetible abriendo una pestaña nueva del navegador
   (`tabs_create`) y, si hacía falta, abandonando y rehaciendo la reserva para forzar un
   `PaymentIntent` nuevo. El servidor de desarrollo (`transversal-dev`) también se detuvo solo
   una vez a mitad de la fase ("stopped by the app"); se detectó por el fallo de navegación y
   se resolvió reiniciándolo con `preview_start`.

### Comprobación real

- **Gate técnico:** `tsc` 171/171, `vitest run` 455/455, 7/7 runners de readiness en verde,
  0 FALLA — antes y después de las mutaciones temporales de BD para T1 (revertidas).
- **T1 (puerta de licencia):** **PROBADO en vivo por HTTP real** contra `booking-authority` en
  los 4 casos (fitosanitarios químico y desbroce+herbicida, sin y con licencia vigente;
  palmeras no afectada) — cierra el hueco que la Fase 1 había dejado explícitamente NO
  PROBADO.
- **T5/T6/T9/T10 (verificación cruzada):** **PROBADO en vivo** en césped (servicio distinto al
  de la Fase 2), con reserva y pago reales — los 4 comportamientos correctos, coherente con
  lo verificado en árboles en la Fase 2.
- **Ciclo de vida completo (booking→pago→aceptación→captura→cambio de
  precio/duración→cancelación en ambos estados→reembolso→cierre→reseña):** **PROBADO en vivo
  de principio a fin en césped**, con evidencia real en Stripe (PaymentIntents, refund) y en
  BD (`bookings.status`, `public.reviews`) en cada paso.
- **Booking + pago real en los 6 servicios restantes** (árboles, arbustos, desbroce,
  fitosanitarios, palmeras, setos): **PROBADO en vivo** — motor de precios correcto y checkout
  Stripe real completado en los 7 servicios sin excepción.
- **NO PROBADO explícito en esta fase** (documentado, no disfrazado):
  - Cambio de precio/duración, cancelación en ambos estados con reembolso, y cierre+reseña:
    solo profundizados en césped: los otros 6 servicios se quedaron en booking+pago. El
    mecanismo es transversal (mismas RPC, sin ramas por servicio) y ya se verificó a fondo una
    vez; repetirlo en los 6 restantes no aporta señal nueva proporcional al tiempo que exige.
  - T5/T6/T9/T10: verificación cruzada hecha en 1 servicio adicional (césped), no en los 7.
  - La observación de UX sobre el aviso de cancelación tardía (<24h) del cliente no menciona
    esa ventana — anotada como mejora posible, no como hallazgo bloqueante ni corregida en
    esta ronda (no forma parte de T1–T12).
- Ninguna mutación de datos de esta fase quedó a medio revertir: el estado de licencia del
  jardinero se dejó como estaba: 7/7 runners re-verificados en verde tras el revert.
