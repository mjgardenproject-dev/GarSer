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
| `scripts/readiness/cesped.mjs` | `auditoria/cesped` | Reescrito: `serviceId` corregido (el de la skill estaba obsoleto), predicciones recalculadas contra el motor real. T2 y T7 marcados `untested(...)` (no FALLA) citando su número aquí; 2A.3b pasó de documentar el hallazgo #1 a comprobar que está corregido. No toca `_harness.mjs`. |
| `src/shared/bookingQuoteCore.ts` | `auditoria/cesped` | **Fase 3 (2026-09-11/12), las dos veces dentro del bloque `if (bookingData.lawnZones?.length)` de horas:** (1) añadida `LAWN_MAX_PLAUSIBLE_AREA_M2 = 2000` y un `pushWarning('lawn_area_implausible', …)` por zona que la supere — arregla el hallazgo #2. (2) sustituida la llamada a `getDurationMultiplier` por el mismo cálculo de `stateMult` que ya usaba el bloque de precio (mismos fallbacks 20 %/50 %) — arregla el hallazgo #1, revisado y autorizado por el usuario en una segunda vuelta tras rechazar el primer enfoque. **No toca** `getDurationMultiplier` en sí (sigue viva para setos `:1275`, desbroce `:1302`, arbustos `:1312`) ni ningún bloque de otro servicio: el fix quedó contenido en el bloque de césped sin tocar código compartido, así que **no era transversal** — la fila T3 que lo documentaba como tal se retiró de §3.2 (ver nota de abajo). |
| `scripts/readiness/arboles.mjs` | `auditoria/arboles` | Reescrito dos veces (2026-09-11): primero por `serviceId` fantasma heredado (`f1bee417-…`, no existe en este entorno; el correcto es `feebd2eb-8347-435c-acda-10537b77e934`), después tras rebasar sobre `origin/main` para reflejar el fix de pago de la PR #18 ya integrado. 15/15 PASA con `READINESS_ENGINE=local` sobre el motor post-rebase (incluye el bloque de césped tocado arriba, que no afecta al bloque de árboles). No toca `_harness.mjs` ni ningún fichero de otro servicio. |

La Fase 2 de césped fue de solo lectura. En Fase 3 (autorizada por el usuario en dos vueltas,
2026-09-11 y 2026-09-12) se corrigieron los dos hallazgos propios de césped: #2 (aviso de
plausibilidad) y #1 (horas ligadas al mismo % que el precio, no al multiplicador fijo
compartido). El hallazgo #1 se documentó primero como T3 en §3.2 creyéndolo transversal; al
resultar que el fix cabía entero dentro del bloque de césped sin tocar `getDurationMultiplier`
ni otro servicio, **T3 se retiró** — no era del apartado que le correspondía. El número T3
queda sin usar a propósito, para no reescribir las referencias cruzadas de T2/T7 a los demás.
T2, T4, T5, T6 y T7 siguen **anotados, no arreglados**, a la espera de la ronda transversal.

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
| A | **No existe ningún reembolso, en ninguna parte.** El cliente paga la tarifa, el profesional rechaza, la reserva se cancela y el dinero no vuelve. Necesita política antes que código. **Corrección parcial (árboles, 2026-09-11):** para el caso "cliente cancela una reserva pendiente >24h antes, con el pago aún sin capturar" esto es falso — el botón "Cancelar reserva" existe en `/bookings` y funciona: probado con pago real (tarjeta de test), `bookings.status→cancelled`, `booking_payment_attempts` con el PaymentIntent que pasa a `status: 'canceled'` en Stripe (`amount_capturable=0`, nada cobrado). No se ha probado cancelar **después** de que el jardinero acepte o después de que el pago se capture (ahí sí haría falta un `refund` de Stripe, no un `cancel`, y no se ha verificado que exista ese camino) — eso sigue pendiente. |
| B | **El cliente no puede cancelar su reserva** desde su área: solo tiene «Chat». **Falso, al menos en `/bookings` (árboles, 2026-09-11):** el botón "Cancelar reserva" está presente y funciona (ver A). No se ha comprobado si también existe en el dashboard de inicio. |

### 3.2 · Encontrados durante estas auditorías

| # | Servicio que lo encontró | Qué falla | Dónde | Afecta a |
|---|---|---|---|---|
| T1 | transversal (ronda previa a los servicios, 2026-09-09) | **No se comprueba la licencia fitosanitaria en ninguna parte del backend.** Un trabajo con producto químico convencional (fitosanitarios no ecológicos, o desbroce con herbicida) es reservable con un jardinero **sin** carnet. `booking-authority` y `booking-payment` tienen 0 referencias a `has_phytosanitary_license`. `ProvidersPage` calcula `requiresCertifiedLicense` pero **nunca filtra la lista** por ese campo (solo cambia textos). Reproducido leyendo código; no probado E2E. | `src/pages/reserva/ProvidersPage.tsx:411-475` (no hay `.filter` por licencia) · `supabase/functions/booking-authority/index.ts` (0 refs) | fitosanitarios, desbroce. El arreglo correcto es un filtro en la capa compartida `booking-authority` / `ProvidersPage`, por eso se anota aquí. |
| T2 | transversal (2026-09-09); **reproducido por césped (2026-09-11)** | Redondeo de horas `if (totalHours > 8) totalHours *= 0.9;` + `Math.ceil(totalHours*2)/2`. La ronda transversal NO lo reprodujo barriendo `totalHours` en decimal (8,001–40,000 @ 0,001) — ese método no lo encuentra porque el residuo depende de la CADENA real de división/multiplicación, no del valor decimal final. Césped SÍ lo reprodujo con una entrada física real: `(5000/150)*0.9` en JS da `30.000000000000004` (residuo `3,55e-15`) en vez de `30` exacto; `Math.ceil(30.000000000000004*2)/2` sube a **30,5 h** en vez de 30,0 h. Verificado dos veces: motor en proceso (`READINESS_ENGINE=local`) y HTTP contra `booking-authority` con `{lawnZones:[{quantity:5000,state:'normal'}], wasteRemoval:false, dataInputMode:'manual'}` (serviceId césped `fe9d2d9e-3f62-4184-aa80-a3289d7c378a`) → mismo resultado los dos. Es un fallo confirmado, no solo una línea frágil: sobrecobra 0,5 h de agenda bloqueada cada vez que `quantity/yield` cae en una fracción binaria imprecisa que además cruza el umbral de 8 h. | `src/shared/bookingQuoteCore.ts:1349-1350` | cualquier servicio que supere 8 h brutas (setos, césped grandes, desbroce, fitosanitarios con área grande) |
| T4 | césped (2026-09-11); **reproducido por árboles (2026-09-11)** | **Al aceptar un cambio de precio, `duration_hours` (y por tanto `end_time` y los bloques de agenda) NO se actualizan — solo cambia `total_price`.** Probado end-to-end: reserva 1000 m² descuidado (216 €/8 h) → jardinero corrige a 1400 m² descuidado y propone 303 € → cliente acepta → `bookings.total_price=303` (correcto) pero `duration_hours` sigue en `8`, `end_time` sigue en la hora original, y `booking_blocks` sigue teniendo solo los bloques originales. Con el motor, 1400 m² descuidado son 11 h reales, no 8. La función solo actualiza `availability` para el rango `[inicio, inicio+duration_hours_ANTIGUO)` — nunca recalcula duración. Consecuencia medida: el "¿se hizo el trabajo?" del cliente se habilita comparando contra `date+start_time+duration_hours` (`needsClientConfirmation`, que usa el mismo `duration_hours` desactualizado), así que el cliente puede ver el aviso de confirmación 3 h antes de que el trabajo real (11 h) pueda haber terminado. | RPC `public.respond_booking_price_change(uuid,boolean,uuid)`, definida en `supabase/migrations/20260909121000_price_change_accept_uses_canonical_schedule.sql:112,117` (`v_duration := COALESCE(v_booking.duration_hours, 1)` — nunca se recalcula) · consumidor del dato desactualizado: `src/shared/bookingStatus.ts:105-111` (`serviceEndMs`) | los 7 servicios — cualquier cambio de precio que también cambie la cantidad/superficie declarada cambia las horas reales, y esta RPC es compartida |

*Reproducción de T4 en árboles (2026-09-11), con un dato adicional que conviene dejar anotado aunque no sea un bug nuevo:* reserva de 1 árbol estructural mediano + dificultad alta (104 €/1,5 h) → jardinero recalcula a estructural grande + dificultad + retirada (225 €/2,5 h) → cliente acepta. Verificado en BD (`bookings id=d45d307d-918c-4e90-864e-19dd3fe60506`): `total_price=225.00` (correcto) pero `duration_hours=2` y `end_time=11:00:00` siguen sin actualizar (deberían ser `3` y `12:00:00` — mismo síntoma que T4). `management_fee` también se queda en `13.00` en vez de recalcular sobre el nuevo total, **pero esto SÍ es diseño deliberado, no parte de T4**: el propio wizard de propuesta de precio se lo dice al jardinero explícitamente («Los gastos de gestión que ya abonaste no cambian»,  visto en pantalla antes de proponer) y el cliente lo ve igual al aceptar. No lo cuentes como hallazgo nuevo si lo vuelves a ver en otro servicio.

| T5 | césped (2026-09-11); **reproducido por árboles (2026-09-11)** | **El botón "Aceptar nuevo precio" / "Rechazar" del DASHBOARD del cliente (`/`, "Hola de nuevo, {nombre}") no hace nada al pulsarlo.** Se renderiza normal (no disabled, sin error visual) pero `cardHandlers` en el componente del dashboard no incluye `onAcceptPriceChange` ni `onRejectPriceChange`, así que el `onClick` del botón llama a `undefined?.(booking)` y no pasa nada: sin request de red, sin cambio de estado. Reproducido con clic real (coordenadas) y con `.click()` programático sobre el elemento — ninguno de los dos dispara nada. **Los mismos botones SÍ funcionan** en `/bookings` (la página completa "Mis reservas", alcanzable con "Ver todas"), que sí conecta `onAcceptPriceChange={() => void respondToPriceChange(booking, true)}`. Un cliente que solo mire el dashboard (lo primero que ve al entrar) no tiene forma de responder a una propuesta de precio. | Roto: `src/components/client/ClientBookingLauncher.tsx:142-150` (objeto `cardHandlers`, sin las dos claves) · Funciona: `src/components/client/BookingsList.tsx:303` | los 7 servicios — `ClientBookingLauncher` es el dashboard genérico, no depende del servicio |
| T6 | césped (2026-09-11); **reproducido por árboles (2026-09-11)** | Menor/cosmético: en el panel del jardinero, "Solicitudes de Reserva", la cabecera de cada solicitud muestra `08:00:00 - 16:00:00 (1h)` — el "(1h)" es SIEMPRE 1 aunque el servicio dure 8 h (correcto un poco más abajo, en "Duración estimada: 8h"). Causa: `{request.booking_blocks?.length || 0}h` usa un array sintético de un único elemento `{start_time, end_time}` construido solo para formatear el rango de texto (no son filas reales de la tabla `booking_blocks`, que para esta reserva sí tenía 8 filas correctas en BD). No afecta al precio ni a las horas reales, pero es una cifra visiblemente incoherente en la misma pantalla y podría hacer dudar al jardinero sobre cuánto dura el trabajo antes de aceptar. Árboles reprodujo con `09:00:00 - 11:00:00 (1h)` junto a "Duración estimada: 2h" en la misma solicitud. | `src/components/gardener/BookingRequestsManager.tsx:502` (usa `.length` del array sintético de `:224`) en vez de `request.duration_hours` (correcto, usado en `:513`) | los 7 servicios — `BookingRequestsManager` es el panel de solicitudes genérico |
| T10 | árboles (2026-09-11) | Menor/cosmético: en `ProvidersPage`, tras elegir hora, el texto "Horario del trabajo: HH:MM – HH:MM" usa `String(selectedHour + estimatedHours).padStart(2,'0')` — con horas fraccionarias (`.5`) el resultado es literalmente `10.5:00` en vez de `10:30`. Reproducido eligiendo un servicio de árboles con `estimatedHours=1.5` a las 09:00 → "09:00 – 10.5:00". No afecta al precio, a las horas bloqueadas en agenda (esas sí redondean bien) ni a `booking_blocks`; es solo el texto de esta pantalla concreta. Cualquier servicio cuya duración caiga en fracción de hora lo dispara. | `src/pages/reserva/ProvidersPage.tsx:1008` (`{String(selectedHour + getEstimatedHours(selectedProvider)).padStart(2,'0')}:00`, no convierte la fracción a minutos) | los 7 servicios — `ProvidersPage` es compartida; se dispara con cualquier `estimatedHours` no entero (0.5, 1.5, 2.5…) |
| T9 | árboles (2026-09-11) | **En "Solicitudes de Reserva" del jardinero, el nombre del cliente siempre muestra "Cliente desconocido", para cualquier cliente y cualquier servicio.** Causa confirmada por SQL: la consulta filtra `profiles` por `.eq('id', client_id)` / `.in('id', clientIds)`, pero `bookings.client_id` guarda el `user_id` del cliente, no el `id` (PK) de `profiles` — son valores distintos (`profiles.id=d86bf1ce-...` vs `profiles.user_id=bookings.client_id=22222222-bbbb-...` para el cliente de pruebas). El filtro nunca encuentra fila y cae siempre al fallback `{ full_name: 'Cliente desconocido' }`. Confirmado que NO es un problema de datos: el mismo cliente aparece correctamente como "Laura Fernández" en "Mis Reservas" del jardinero (pantalla distinta, consulta distinta) y en el dashboard del jardinero. El jardinero no puede saber quién es el cliente antes de aceptar una solicitud — en ningún servicio. | `src/components/gardener/BookingRequestsManager.tsx:156,163` (`.eq('id', singleId)` / `.in('id', clientIdsFiltered)` sobre `profiles`, debería ser `.eq('user_id', ...)` / `.in('user_id', ...)`) | los 7 servicios — mismo componente `BookingRequestsManager`, reproducible con cualquier solicitud pendiente de cualquier servicio |
| T7 | césped (2026-09-11) | **Un trabajo que no cabe en un único día se queda sin ningún hueco reservable en ninguna fecha, y sin ningún aviso al cliente de por qué.** El fixture solo siembra jornadas de un día (L-V 08-18 = 10 bloques de 1h, sábado 5). Cualquier servicio cuyas horas estimadas superen esos 10 bloques queda excluido de `preview_providers`/`valid_hours` en **todas** las fechas probadas (21 días), con el mismo código genérico `no_reservable_availability` que se usa para "esta fecha en concreto no tiene hueco" — nada distingue "prueba otro día" de "este trabajo no se puede reservar nunca". Es un hueco de producto general al tamaño del trabajo, no a ningún estado concreto: reproducido con **1700 m² de césped en estado NORMAL** (sin recargo alguno, `(1700/150)·0,9=10,2h→10,5h→11 bloques`) — falta reserva multi-día o, como mínimo, un aviso de "trabajo extenso" antes de mandar al cliente a un paso de selección sin huecos. | No hay ningún sitio que calcule "¿cabe este trabajo en algún día?" de forma explícita ni que avise de ello; el síntoma se observa en `supabase/functions/booking-authority/index.ts` (acciones `preview_providers`/`valid_hours`, exclusión `no_reservable_availability`) | los 7 servicios — cualquiera cuyo `estimatedHours` pueda superar la jornada más larga sembrada para un profesional |
| T8 | árboles (2026-09-11) | Cuando el sondeo del cliente agota sus intentos (`POLL_MAX_ATTEMPTS=8` × `POLL_INTERVAL_MS=1500` ≈ 12 s) con el intento **todavía** en `payment_pending` (ni `booking_created`, ni `processing`, ni ningún otro estado terminal), el callback `onConfirmed` no entra en **ninguna** de sus tres ramas (`booking_created` / `processing` / `status !== 'payment_pending'`) y no hace nada: ni `toast.error`, ni aviso, ni retry guiado. El formulario de pago simplemente vuelve a su estado inicial con la tarjeta ya rellenada, como si no se hubiera intentado nada — mientras Stripe puede tener el importe ya autorizado. Un reintento del cliente sobre ese mismo `PaymentIntent` ya confirmado falla con «Se ha producido un error de procesamiento», también sin explicar por qué. Detectado la madrugada del 2026-09-11 mientras el stack de referencia servía una versión de `booking-payment` desactualizada respecto a `origin/main` (por entonces sin `|| paymentIntentStatus === 'requires_capture'`), que hacía que el sondeo agotara siempre sus intentos; el stack ya se actualizó (§4b, tras el merge de la PR #20) así que ese disparador concreto ya no debería ocurrir en el camino feliz, pero el hueco de manejo de errores en sí — ninguna rama cubre "el sondeo se agotó y sigue pendiente" — sigue presente en el código y lo dispara cualquier lentitud real de Stripe/red. | `src/pages/reserva/ConfirmationPage.tsx:2101-2118` (rama que falta: `latest?.status === 'payment_pending'` tras agotar el sondeo) | Los 7 servicios: `ConfirmationPage.tsx` y el sondeo de pago son compartidos, no específicos de árboles. |

---

## 4. Cómo se cierra un servicio

1. Runner en verde con el motor en proceso: `READINESS_ENGINE=local node scripts/readiness/<servicio>.mjs`
2. **Tipos:** `npx tsc --noEmit -p tsconfig.app.json` — este es el gate real. `tsconfig.json`
   tiene `"files": []` y sólo `references`, así que `tsc -p tsconfig.json` NO comprueba ningún
   fichero (siempre pasa: es un no-op). Criterio: `main` arrastra **173 errores** (en su
   mayoría `TS6133` de variables sin usar); el número **no puede subir de 173**, y cualquier
   fichero que toque tu servicio queda **sin errores nuevos**. `npx vitest run` sin fallos.
3. Informe al usuario. **Él abre la PR y decide el turno.**
4. **Tras el merge, dos cosas en el mismo momento. Las dos, siempre.**

   **4a · Producción.** El orden importa: la base de datos, luego las funciones, luego el
   front.

   ```bash
   supabase db push
   ```
   ```bash
   supabase functions deploy <fn> --use-api
   ```

   Y por último Vercel.

   **4b · El entorno local compartido.** Lo hace el usuario, no un chat de servicio:
   reiniciar Supabase corta a todas las sesiones unos segundos. Sin este paso, el stack
   sigue sirviendo las funciones y el esquema de antes del merge, y los chats miden código
   viejo sin enterarse. **Ya pasó el 2026-09-10**: se mezcló el #18 con el arreglo del
   pago, el stack no se actualizó, y un chat de servicio vio el pago fallar igual que antes.

   Traer el código y reiniciar, para que Supabase cargue las funciones nuevas:

   ```bash
   cd ~/Downloads/GarSer-referencia && git pull && supabase stop && supabase start
   ```

   Aplicar las migraciones a la base local, sin borrar datos:

   ```bash
   cd ~/Downloads/GarSer-referencia && supabase migration up
   ```

   Comprobar que no queda ninguna pendiente. **Si no imprime nada, está al día**:

   ```bash
   cd ~/Downloads/GarSer-referencia && comm -23 <(ls supabase/migrations/*.sql | xargs -n1 basename | cut -d_ -f1 | sort -u) <(docker exec -i supabase_db_GarSer-referencia psql -U postgres -d postgres -tAc "select version from supabase_migrations.schema_migrations" | sort -u)
   ```

   Y avisar a los chats activos: *«El entorno compartido se ha actualizado con el merge de
   la PR #N. Rebasa tu worktree sobre `origin/main` y repite las pruebas que pasen por lo
   que ha cambiado: lo medido antes ya no vale.»*
5. Se ejecutan **todos** los runners, ya por HTTP, no solo el del servicio recién integrado.
6. Siguiente servicio.

---

## 5. Estado de las auditorías

| Rama | Servicio | Estado |
|---|---|---|
| `auditoria/cesped` | Corte de césped | Fases 1-3 completas (2026-09-12). Corregidos los dos hallazgos propios: #2 (aviso de plausibilidad) y #1 (horas ligadas al % configurado, no a `getDurationMultiplier`). T2/T4/T5/T6/T7 anotados aquí, sin tocar — esperan ronda transversal. Runner en verde, listo para PR |
| `auditoria/setos` | Poda de setos | Sin empezar |
| `auditoria/arboles` | Poda de árboles | Fases 1+2 cerradas (2026-09-11, segunda vuelta tras rebase sobre origin/main), veredicto GO con 2 graves pendientes — ver informe |
| `auditoria/palmeras` | Poda de palmeras | Sin empezar |
| `auditoria/arbustos` | Poda de plantas y arbustos | Sin empezar |
| `auditoria/desbroce` | Desbroce de malas hierbas | Sin empezar |
| `auditoria/fitosanitarios` | Servicios fitosanitarios | Sin empezar |
