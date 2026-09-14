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
| 4 | T2 (redondeo de horas, con recálculo a mano de los runners afectados) | ⏳ Pendiente | — |
| 5 | T8 (rama que falta en el sondeo de pago agotado) + cierre formal de T4 (confirmar que el fix de la Fase 1 resuelve el hallazgo original) | ⏳ Pendiente | — |
| 6 | T7 (D4-a: aviso de trabajo que no cabe en un día) + T11 (diagnóstico del email de confirmación no enviado) | ⏳ Pendiente | — |
| 7 | **Verificación total**: los 7 servicios de principio a fin, no solo lo tocado en las fases 1–6 | ⏳ Pendiente | — |

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

## Fase 4 — T2: redondeo de horas ⏳ PENDIENTE

**Hallazgo:** `if (totalHours > 8) totalHours *= 0.9;` seguido de `Math.ceil(totalHours*2)/2`
en `src/shared/bookingQuoteCore.ts:1349-1350`. El problema no es la fórmula en sí sino la
imprecisión de coma flotante en la cadena de división/multiplicación real (`(5000/150)*0.9` da
`30.000000000000004` en vez de `30` exacto), que el `Math.ceil` sube a medio bloque de más
justo cuando el resultado cruza un umbral entero. Confirmado con inputs reales de césped y de
desbroce, en dos servicios independientes — no es un caso aislado.

**Alcance:** cualquier servicio cuyas horas brutas superen 8h (setos, césped grande, desbroce,
fitosanitarios con área grande).

**⚠️ Aviso del propio protocolo de esta auditoría, ya dado por el usuario al principio:**
arreglar T2 **cambia legítimamente** las horas esperadas en los runners existentes. Cuando eso
pase: **recalcular a mano la cifra correcta** usando las tarifas reales del jardinero sembrado
y actualizar el runner con una explicación en el commit — nunca ajustar el número hasta que
"pase el test".

### Registro del proceso
*(se completa según avance la fase)*

### Comprobación real
*(pendiente)*

---

## Fase 5 — T8 + cierre formal de T4 ⏳ PENDIENTE

### T8 — rama que falta en el sondeo de pago agotado

**Hallazgo:** si el sondeo del cliente agota sus intentos con el `PaymentIntent` todavía en
`payment_pending` (ni éxito ni error terminal), `onConfirmed` no entra en ninguna de sus tres
ramas y no hace nada — ni aviso, ni retry guiado. El disparador original (stack desactualizado
sin `requires_capture`) ya no debería darse, pero el hueco de manejo de errores sigue en el
código.

**Dónde:** `src/pages/reserva/ConfirmationPage.tsx:2101-2118` (falta la rama
`latest?.status === 'payment_pending'` tras agotar el sondeo).

**Antes de tocar código:** confirmar que la línea sigue ahí (puede haberse movido con los
cambios de T1/T4 en ficheros cercanos) y decidir el mensaje/acción correcta para esa rama
(probablemente: avisar al cliente de que el pago puede seguir procesándose y ofrecer refrescar
antes de dejarle reintentar sobre el mismo `PaymentIntent`).

### Cierre formal de T4

T4/D5 ya se implementó y verificó en la Fase 1. Esta fase solo confirma, releyendo la entrada
original de §3.2 línea por línea, que el fix realmente cubre el escenario exacto que describía
el hallazgo (cambio de precio que refleja más cantidad → duración/agenda se actualizan) y no
solo el camino nuevo de D5. Si algo del hallazgo original queda sin cubrir, se corrige aquí.

### Registro del proceso
*(se completa según avance la fase)*

### Comprobación real
*(pendiente)*

---

## Fase 6 — T7 (D4-a) + T11 ⏳ PENDIENTE

### T7 — trabajo que no cabe en un día

**Decisión del usuario (D4-a):** fix mínimo y honesto. Detectar que `estimatedHours` supera la
jornada más larga disponible del profesional y avisar al cliente de que el trabajo no cabe en
un único día — sin construir un sistema de reserva multi-día.

**Dónde:** no hay ningún sitio que calcule esto hoy; el síntoma se observa en
`supabase/functions/booking-authority/index.ts` (`preview_providers`/`valid_hours`, exclusión
genérica `no_reservable_availability`, indistinguible de "esta fecha en concreto no tiene
hueco").

**Nota de alcance:** T7 vive en una función desplegada (`booking-authority`) que este entorno
no sirve en vivo por HTTP (mismo motivo que el filtro de T1) — el fix se verificará con
`READINESS_ENGINE=local` + tests unitarios, y el camino HTTP quedará NO PROBADO hasta que el
usuario despliegue, igual que T1.

### T11 — email de confirmación no se envía nunca

**Hallazgo:** `admin.functions.invoke('booking-confirmation-email', ...)` dentro de
`booking-payment-webhook/index.ts:644` devuelve `401 Unauthorized`, aunque la misma llamada por
`curl` con la misma `service_role_key` funciona (`200 OK`). Hipótesis sin confirmar: la versión
de `supabase-js` resuelta por el import sin pin (`esm.sh/@supabase/supabase-js@2`) puede
diferir entre aislados de Deno y cambiar cómo `functions.invoke()` construye la cabecera
`Authorization`.

**Plan:** esto es un diagnóstico, no un fix claro todavía. Pasos sugeridos por el propio
hallazgo: loguear temporalmente la cabecera `Authorization` que recibe
`isInternalServiceCaller`, o sustituir `admin.functions.invoke(...)` por un `fetch()` crudo con
la cabecera explícita. Si tras investigar no se llega a una causa confirmada y corregible con
confianza, se documenta como **NO PROBADO / diagnóstico abierto** en vez de aplicar un fix a
ciegas — este es exactamente el tipo de hallazgo que el usuario pidió no disfrazar de resuelto.

### Registro del proceso
*(se completa según avance la fase)*

### Comprobación real
*(pendiente)*

---

## Fase 7 — Verificación total final ⏳ PENDIENTE

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
*(se completa al llegar a esta fase)*

### Comprobación real
*(pendiente — es, por definición, la última sección que se rellena de todo el documento)*
