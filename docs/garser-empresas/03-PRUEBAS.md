# GarSer Empresas — Pruebas

> Cada fase aporta aquí sus pruebas **antes** de darse por cerrada, y cada prueba se escribe
> también en su versión de producción, para la batería final sobre `garser.es`.
>
> Regla: una prueba que no se ha ejecutado se marca `⬜ no ejecutada`. **No se marca ✅ por
> haberla escrito.** Si falla y se decide seguir igualmente, se marca ❌ y se explica por qué.

**Última actualización:** 2026-09-23 (decisiones D1–D6)
**Línea base:** 462 tests en verde / 68 ficheros · `tsc` 130 errores (preexistentes)

---

## 1. Batería de no regresión — se ejecuta en TODAS las fases

El criterio que manda sobre cualquier otro: **el autónomo no se rompe.**

| # | Prueba | Cómo | Estado |
|---|---|---|---|
| R-01 | `npm test` ≥ 462 en verde | Automático | ✅ F2 cerrada: 473 |
| R-02 | `npm run build` pasa | Automático | ✅ F2 cerrada |
| R-03 | `npm run typecheck` no sube de 130 | Automático, informativo | ✅ F2 cerrada: 129 |
| R-04 | Funnel completo de autónomo: servicio → fotos → precio → profesional → fecha → comisión → confirmación | Manual, en local | 🟨 F1: por API real (`valid_hours`, `create_quote`, preparar y confirmar pago). Sin recorrer la interfaz: F1 no toca frontend ni `booking-authority` |
| R-05 | Reserva de autónomo: las horas se bloquean y se liberan igual que antes | Manual + SQL | ✅ F1 (F1-03a, F1-04, por el camino real de pago) |
| R-06 | Cambio de precio **con cambio de duración** aceptado: la agenda se redimensiona | Manual | ✅ F1 (F1-05, F1-06) |
| R-07 | Cancelación con política de 24 h | Manual | 🟨 F1: cancelación a más de 24 h ✅ (F1-04). El tramo de menos de 24 h no se ha probado |
| R-08 | Incidencia y no-show | Manual | 🟨 F1: no ejecutada. Usan la misma `release_booking_schedule` que la cancelación (probada); para un autónomo el cambio es neutro (`assignee_id` = proveedor) |
| R-09 | Cada tipo de cuenta entra a su panel: cliente, autónomo, admin | Manual, 3 cuentas | ✅ F0 (y además jardinero sin solicitud, pendiente y rechazado) |
| R-10 | Un autónomo sin empresa no ve **nada** de empresas en ninguna pantalla | Manual | ✅ F0 (aún no existe nada de empresas) |

> **R-04 a R-08 no se han ejecutado en F0** a propósito: F0 no toca ni reservas, ni agenda, ni
> precios, ni pagos. Se ejecutan al cerrar **F1**, que sí toca la agenda.
>
> R-06 es nueva respecto a auditorías anteriores: `resize_booking_schedule()` es de
> 2026-09-13 y toca la misma agenda que la Fase 1. Ver hallazgo H-03.

---

## 2. Pruebas por fase

### F0 — Fuente única de rol

*Objetivo: cero cambios visibles.*

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F0-01 | Cliente entra en `/dashboard` | Panel de cliente | ✅ 2026-09-23 (navegador, móvil: barra «Inicio») |
| F0-02 | Autónomo activo entra en `/dashboard` | Panel de jardinero | ✅ 2026-09-23 (móvil: barra «Panel», antes «Inicio»: H-16) |
| F0-03 | Autónomo con solicitud pendiente | Redirige a `/status` | ✅ 2026-09-23 («Solicitud en revisión») |
| F0-04 | Autónomo con solicitud denegada | Redirige a `/status` con el motivo | ✅ 2026-09-23 (motivo visible) |
| F0-05 | Usuario con intención de jardinero sin solicitud | Redirige a `/apply` | ✅ 2026-09-23 (registrado **desde la web**; `/dashboard` también lleva a `/apply`) |
| F0-06 | Admin entra en `/dashboard` | Redirige a `/admin/dashboard` | ✅ 2026-09-23 |
| F0-07 | Borrar `localStorage` y recargar estando logueado | El rol se resuelve igual | ✅ 2026-09-23 — reformulada: la sesión de Supabase vive en `localStorage`, así que borrarlo cierra sesión; al volver a entrar, el rol es el mismo. La prueba que importa es F0-08 |
| F0-08 | Poner `localStorage.signup_role = 'gardener'` en una cuenta de cliente | **Se ignora.** Sigue siendo cliente | ✅ 2026-09-23 (sigue en su panel; `/bookings` muestra la lista de cliente) |
| F0-09 | `UPDATE profiles SET role='admin'` desde el cliente vía PostgREST | Denegado | ✅ ya hoy (2026-09-23): lo bloquea `prevent_role_escalation` |
| F0-10 | **Cuenta nueva registrada por API crea su perfil con `role='admin'`** (H-11) | Denegado | ✅ 2026-09-23 — HTTP 403 con y sin perfil previo (antes de la migración: HTTP 201) |
| F0-11 | Cuenta nueva registrada por la web **tiene perfil** nada más registrarse (H-12) | Perfil creado por el servidor | ✅ 2026-09-23 (por API y **por el formulario de la web**, jardinero y cliente) |
| F0-17 | Monitor de roles con un jardinero **pendiente** (rol `gardener`, sin `gardener_profiles`) | No lo marca | ✅ 2026-09-23 (la regla antigua lo habría degradado) |
| F0-18 | Monitor de roles con un jardinero **aprobado** puesto a `client` | Lo marca y «Corregir» lo deja en `gardener` | ✅ 2026-09-23 |
| F0-19 | Registro desde la web sin errores de consola | Ninguno | ✅ 2026-09-23 (tras quitar un aviso falso de una consulta obsoleta) |
| F0-20 | Pruebas unitarias nuevas: `accountRole` (2), `AccountContext` (6, incluida la carrera entre sesiones), `BottomNav` (3) | Verdes | ✅ 2026-09-23 |
| F0-12 | Registro con intención «jardinero» → perfil `gardener`; resto → `client` | Correcto | ✅ 2026-09-23 |
| F0-13 | Registro por API con `data.role = 'admin'` | Perfil `client`, nunca `admin` | ✅ 2026-09-23 |
| F0-14 | Tu correo corporativo sigue siendo admin al registrarse | Admin | ✅ 2026-09-23 (antes de F0 fallaba con HTTP 500: H-15) |
| F0-15 | `supabase db reset` desde cero, con la semilla | Sin errores; 3 cuentas con su rol | ✅ 2026-09-23 |
| F0-16 | Relleno: cuentas sin perfil reciben uno con el rol correcto | 0 cuentas sin perfil | ✅ 2026-09-23 (en transacción deshecha) |

> Las pruebas F0-09 a F0-14 se repiten con `node scripts/garser-empresas/verify-f0-db.mjs`.
> Se niega a correr contra nada que no sea `127.0.0.1`.

> F0-08 y F0-09 son las que justifican la fase. Si pasan, el rol ha dejado de ser
> manipulable desde el navegador.

---

### F1 — Registro de capacidad

*Objetivo: el punto de no retorno, sin pérdida de datos.*

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F1-00 | **Antes de migrar en producción:** consultar solapes y bloques sin atribuir | Cero. Consultas en `01-PLAN-Y-PROGRESO.md` §6 | ⬜ (día de la fusión) |
| F1-01 | Ningún `assignee_id` a `NULL` y la columna es `NOT NULL` | Correcto | ✅ 2026-09-23 |
| F1-02 | Migración sobre **reservas existentes**: todas las horas quedan atribuidas | 4/4 bloques con ejecutante = jardinero | ✅ 2026-09-23 |
| F1-02b | Migración con una **doble venta ya existente** | Se detiene y no toca nada | ✅ 2026-09-23 (la columna ni se crea) |
| F1-02c | Migración con un **bloque sin reserva** | Se detiene y no toca nada | ✅ 2026-09-23 |
| F1-03a | Reserva pagada (camino de Stripe) bloquea sus horas | Bloques = duración | ✅ 2026-09-23 |
| F1-03b | Cada hora pagada sabe quién la trabaja | `assignee_id` = el jardinero | ✅ 2026-09-23 (❌ antes: no existía) |
| F1-03c | El jardinero acepta una reserva pendiente | Confirmada, bloques intactos | ✅ 2026-09-23 |
| F1-04 | Cancelar libera las horas de quien las trabajaba | Horas libres, sin bloques | ✅ 2026-09-23 |
| F1-05 | Negociar una hora más **con horas libres**, en un día sin filas en `availability_blocks` | La agenda se redimensiona y la reserva se confirma | ✅ 2026-09-23 (❌ antes: H-01) |
| F1-05b | La hora añadida sabe quién la trabaja | `assignee_id` = el jardinero | ✅ 2026-09-23 |
| F1-06 | Negociar más horas **sin sitio** (pisaría otra reserva) | Falla entero, nada a medias, la otra reserva intacta | ✅ 2026-09-23 |
| F1-07a | Un bloque insertado sin ejecutante lo hereda del proveedor | Correcto | ✅ 2026-09-23 |
| F1-07b | Un bloque sin reserva ni ejecutante | Rechazado | ✅ 2026-09-23 |
| F1-08 | **Disponibilidad desincronizada + segundo cliente paga la misma hora** | No hay doble venta; el pago queda en `reconciliation_required` | ✅ 2026-09-23 (❌ antes: **se vendió dos veces**, H-19) |
| F1-10 | Aceptar una reserva sin horas bloqueadas (ejercita `reserve_booking_schedule`), en un día sin filas en `availability_blocks` | Reserva la agenda | ✅ 2026-09-23 (❌ antes: H-01) |
| F1-11 | **Concurrencia real:** dos aceptaciones simultáneas de la misma hora (`Promise.all`) | Gana una; la otra, error claro; un solo bloque | ✅ 2026-09-23, repetida 3 veces |
| F1-12 | `db reset` desde cero con la migración y la semilla | 115/115, sin errores | ✅ 2026-09-23 |

> Se repiten con `node scripts/garser-empresas/verify-f1-schedule.mjs` (13 comprobaciones).
> Crea reservas, clientes temporales e intentos de pago reales y los borra al terminar; retira
> las filas de `availability_blocks` del día de prueba y las repone. Solo corre contra
> `127.0.0.1`. Las pruebas F1-02 se hicieron a mano (base en estado previo a F1 + datos +
> `migration up`): el procedimiento está en el commit de F1.

---

### F2 — Modelo de proveedor y RLS

*Se prueba contra la API, nunca contra la interfaz.*

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F2-01 | Todos los `gardener_profiles` existentes quedan con `provider_kind='solo'` | Sin excepciones | ✅ 2026-09-24 |
| F2-02 | Empleado de la empresa A consulta `company_members` | Solo su propia fila (nada de B, ni la plantilla de A) | ✅ 2026-09-24 |
| F2-03 | Empleado consulta `companies` | Solo la suya | ✅ 2026-09-24 |
| F2-04 | Empleado intenta escribir en `companies` de la suya | Denegado (403) | ✅ 2026-09-24 |
| F2-05 | Cliente consulta las cuatro tablas de empresas | Cero filas | ✅ 2026-09-24 |
| F2-06 | Las policies nuevas no provocan recursión | Responden 200 | ✅ 2026-09-24 |
| F2-07 | **Un cliente se crea una ficha de proveedor** (H-21a) | Denegado | ✅ 2026-09-24 (❌ antes: HTTP 201, salía reservable) |
| F2-08 | **Un jardinero con carnet rechazado se lo aprueba** (H-21b) | Denegado, sigue rechazado | ✅ 2026-09-24 (❌ antes: HTTP 204, quedaba aprobado) |
| F2-09 | El jardinero sigue editando su ficha (descripción) | Permitido | ✅ 2026-09-24 (no regresión) |
| F2-10 | Empleado con ficha de proveedor / autónomo metido como empleado | Ambos rechazados por la BD (A-03) | ✅ 2026-09-24 |
| F2-11 | Una persona en dos empresas / dos dueños en una empresa | Rechazados | ✅ 2026-09-24 |
| F2-12 | El dueño ve su equipo, sus servicios, sus invitaciones y su empresa; nada de otra | Correcto | ✅ 2026-09-24 |
| F2-13 | El empleado ve solo sus servicios y ninguna invitación | Correcto | ✅ 2026-09-24 |
| F2-14 | El dueño tampoco escribe directamente (empresa, miembros, invitaciones); un empleado no se hace dueño | 403 en todo | ✅ 2026-09-24 |
| F2-15 | Visitante sin sesión | 401 en las cuatro tablas | ✅ 2026-09-24 |
| F2-16 | El admin ve todas las empresas y miembros | Correcto | ✅ 2026-09-24 |
| F2-17 | Un jardinero se cambia a sí mismo a empresa (`provider_kind`) | Denegado | ✅ 2026-09-24 |
| F2-18 | **El admin aprueba a un jardinero:** se crea su ficha (tipo `solo`) y su rol | Correcto | ✅ 2026-09-24 (no regresión tras H-21) |

> Se repiten con `node scripts/garser-empresas/verify-f2-db.mjs` (18 comprobaciones). Monta dos
> empresas desechables y lo borra todo al terminar. Solo corre contra `127.0.0.1`.

---

### F3 — Alta de empresa y empleados

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F3-01 | Aceptar invitación con token válido y el mismo correo | Empleado de la empresa del token, rol `employee` | ✅ F3.1 |
| F3-02 | Aceptar con token caducado | Rechazado | ✅ F3.1 |
| F3-03 | Aceptar dos veces el mismo token | La segunda, rechazada | ✅ F3.1 |
| F3-04 | **Aceptar con `company_id` manipulado en la petición** | No entra en otra empresa | ✅ F3.1 (la función ni siquiera admite ese parámetro: 404) |
| F3-05 | Un autónomo activo acepta una invitación de empleado | Bloqueado, con explicación | ✅ F3.1 |
| F3-06 | El token no aparece en claro en la base de datos | Solo el hash | ✅ F3.1 |
| F3-07 | Empleado intenta crearse un `gardener_profiles` | Denegado | ✅ F3.1 |
| F3-08 | Empleado no aparece en `public_gardener_directory` | Cero filas | ✅ F3.1 |
| F3-09 | Empresa **sin aprobar** (D2) | Sin ficha de proveedor, fuera del directorio | ✅ F3.1 (servidor); en el funnel, F4 |
| F3-10 | El admin ve la solicitud de empresa con las respuestas de la encuesta; nadie más | Correcto | ✅ F3.1 (datos); su sección en el panel, F3.2 |
| F3-11 | Marcar a un empleado un servicio que la empresa **no** tiene activo (D5) | No se permite | ✅ F3.1 |
| F3-12 | Activar fitosanitarios a un empleado **sin carnet** aprobado (D4) | No se permite | ✅ F3.1 |
| F3-13 | Empleado con carnet **caducado** | Se le quita el servicio fitosanitario | ✅ F3.1 |
| F3-14 | Dueño activa y desactiva «Yo también trabajo» (D3) | Cambia; un empleado no puede | ✅ F3.1 |
| F3-20 | Un cliente abre una solicitud de empresa | Denegado | ✅ F3.1 |
| F3-21 | Registrarse como empresa | Rol `company` (A-20) | ✅ F3.1 |
| F3-22 | Enviar la solicitud incompleta / aprobarse uno mismo | Rechazados; el error dice qué falta | ✅ F3.1 |
| F3-23 | Cambiar la solicitud después de enviarla | No cambia | ✅ F3.1 |
| F3-24 | Solo el admin aprueba; se crean ficha `company`, empresa y dueño | Correcto | ✅ F3.1 |
| F3-25 | El admin rechaza con motivo | Rechazada, no se crea nada | ✅ F3.1 |
| F3-26 | Solo el dueño invita; el token se devuelve una vez | Correcto | ✅ F3.1 |
| F3-27 | Token válido, pero sesión con **otro correo** | Rechazado | ✅ F3.1 |
| F3-28 | Invitación anulada | No se puede aceptar | ✅ F3.1 |
| F3-29 | Un empleado se asigna servicios | Denegado | ✅ F3.1 |
| F3-30 | El dueño asigna un servicio activo | Correcto | ✅ F3.1 |
| F3-31 | Empleado sube carnet → admin lo aprueba → se le puede activar fitosanitarios | Correcto | ✅ F3.1 |
| F3-32 | Un cliente sin empresa ni ficha sube un carnet | Denegado | ✅ F3.1 |
| F3-33 | El dueño ve los datos de su equipo; un compañero no ve los de otro | Correcto | ✅ F3.1 |
| F3-34 | Dar de baja a un empleado con trabajos futuros | Bloqueado | ✅ F3.1 |
| F3-35 | Dar de baja sin trabajos pendientes | Vuelve a cliente y pierde el acceso | ✅ F3.1 |
| F3-36 | **Crear una licencia ya aprobada** (H-22) | Denegado | ✅ F3.1 (❌ antes: HTTP 201) |
| F3-37 | El dueño ve su equipo en una llamada (servicios y estado del carnet de cada uno); un empleado o un cliente no | Correcto | ✅ F3.3 |
| F3-38 | El empleado ve a qué empresa pertenece, sus servicios y si la empresa hace fitosanitarios | Correcto | ✅ F3.3 |
| F3-39 | Preguntar por la API si **otra persona** tiene carnet (`has_valid_phyto_license`) | Denegado (H-23) | ✅ F3.3 (❌ antes: cualquiera podía) |
| F3-51 | El enlace de invitación, **sin sesión**, dice quién invita y si vale (válida / anulada / usada / inventada) | Correcto; un token inventado no revela nada | ✅ F3.3 |

| F3-40 | Registro con `/auth?mode=signup&role=company`: 3 opciones legibles en móvil, «Empresa» preseleccionada | Cuenta con rol `company` | ✅ F3.2 (navegador, 375 px) |
| F3-41 | La empresa entra y va sola a la encuesta | `/empresa/solicitud` | ✅ F3.2 |
| F3-42 | «Siguiente» con el paso vacío | Dice qué falta; no avanza | ✅ F3.2 («Te falta: el nombre comercial, la razón social, el CIF.») |
| F3-43 | Recargar a mitad de la encuesta | Recupera el borrador y retoma en el primer paso pendiente; un «No» explícito se conserva | ✅ F3.2 |
| F3-44 | Elegir fitosanitarios muestra la pregunta del carnet | Sí | ✅ F3.2 |
| F3-45 | Enviar sin las casillas / con todo | Avisa / «Solicitud en revisión» | ✅ F3.2 |
| F3-46 | El admin ve la solicitud en su sección, con todas las respuestas y el correo, y la aprueba con confirmación | Se crean ficha `company`, empresa y dueño (sin trabajar, como contestó) | ✅ F3.2 (móvil) |
| F3-47 | La empresa aprobada entra | `/empresa` (panel) | ✅ F3.2 |
| F3-48 | El admin rechaza: sin motivo el botón está desactivado; con motivo, rechaza | Correcto | ✅ F3.2 |
| F3-49 | La empresa rechazada ve el motivo; «Corregir y enviar de nuevo» abre la encuesta rellena; reenvía | Nueva solicitud enviada; la rechazada queda de histórico | ✅ F3.2 |
| F3-50 | No regresión: jardinero → «Panel de Jardinero»; cliente → su panel; cliente en `/empresa` → vuelve a su panel | Correcto | ✅ F3.2 |
| F3-52 | Panel de empresa sin servicios: aviso «Aún no ofreces ningún servicio» que lleva a configurarlos | Correcto | ✅ F3.3 (móvil) |
| F3-53 | «Servicios, precios y zona» abre la misma configuración que un autónomo, con la ficha de la empresa | Correcto | ✅ F3.3 |
| F3-54 | La empresa invita por correo: sale el enlace para copiar y la invitación pendiente con su caducidad | Correcto | ✅ F3.3 |
| F3-55 | El invitado abre el enlace **sin cuenta**: «Jardines Demo Costa te invita a su equipo», con el correo que debe usar | Correcto | ✅ F3.3 |
| F3-56 | Crea la cuenta desde el enlace y vuelve a entrar **por la portada** (como tras confirmar el correo): la invitación se retoma sola | Correcto (H-25) | ✅ F3.3 |
| F3-57 | Acepta: pasa a empleado y cae en «Mi trabajo»; `/dashboard` le lleva siempre ahí | Correcto | ✅ F3.3 |
| F3-58 | El empleado guarda nombre y teléfono; su empresa los ve en su tarjeta | Correcto | ✅ F3.3 |
| F3-59 | Empresa con fitosanitarios: el empleado sube su carnet (queda «En revisión») | Correcto | ✅ F3.3 |
| F3-60 | El admin ve el carnet como «Lucía Martín · empleado de Jardines Demo Costa» y lo aprueba | Correcto | ✅ F3.3 |
| F3-61 | La empresa ve «Carnet aprobado» y le asigna césped + fitosanitarios; el empleado los ve en su panel | Correcto | ✅ F3.3 |
| F3-62 | El dueño activa «Yo también trabajo»: puede asignarse servicios; fitosanitarios bloqueado hasta subir **su** carnet en «Tu empresa» | Correcto (H-24) | ✅ F3.3 |
| F3-63 | «Dar de baja» pide confirmación con el nombre; cancelar no cambia nada | Correcto | ✅ F3.3 |
| F3-64 | El dueño abre su propio enlace: le explica que es para enviarlo y le devuelve a su empresa | Correcto | ✅ F3.3 |
| F3-65 | No regresión: un cliente normal entra a su inicio; ningún error en consola | Correcto | ✅ F3.3 |

**Correos (F3.4)** — `node scripts/garser-empresas/verify-f3-emails.mjs` (10 comprobaciones,
contra la función local; tras cambiarla: `docker restart supabase_edge_runtime_GarSer-main_4`):

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F3E-01 | Avisar de «aprobada» con la solicitud aún sin aprobar | 409, no sale | ✅ F3.4 |
| F3E-02 | Pedir el correo de aprobada como anónimo, cliente o la propia empresa | 403 | ✅ F3.4 |
| F3E-03 | El admin lo pide con un `to` inyectado | Llega al correo de la empresa, no al inyectado | ✅ F3.4 |
| F3E-04 | Solicitud rechazada: pedir «aprobada» / «rechazada» | 409 / sale al correo de la empresa | ✅ F3.4 |
| F3E-05 | Correo de invitación pedido por anónimo, por un cliente o con token equivocado | 403 | ✅ F3.4 |
| F3E-06 | El dueño lo pide (con un `to` inyectado) | Llega al invitado, con el nombre de la empresa; queda marcado | ✅ F3.4 |
| F3E-07 | Pedirlo otra vez para la misma invitación | 403 | ✅ F3.4 |
| F3E-08 | Invitación anulada | No se envía | ✅ F3.4 |
| F3E-09 | Llamar desde el navegador a la función que marca el envío | 403 | ✅ F3.4 |
| F3E-10 | Invitación número 21 del día | Rechazada con explicación | ✅ F3.4 |
| F3-66 | Desde la web, la empresa invita: «Le hemos enviado la invitación a …» y el enlace por si acaso | Correcto (correo simulado en local) | ✅ F3.4 (móvil) |
| F3-67 | Desde la web, el admin rechaza una empresa con motivo: sale el correo a esa empresa | Correcto | ✅ F3.4 (móvil) |

> Las pruebas de servidor se repiten con `node scripts/garser-empresas/verify-f3-db.mjs`
> (35 comprobaciones, incluidas F3-37 a F3-39 y F3-51). Las de pantallas (F3-40 a F3-50 y
> F3-52 a F3-65) se hicieron en el navegador, en móvil (375 px).

> F3-04 es la prueba de seguridad principal de toda la fase de empresas.

---

### F4 — La empresa vende

**Servidor (F4.1)** — `node scripts/garser-empresas/verify-f4-sell.mjs` (21 comprobaciones por
los caminos reales: `booking-authority`, prepare/confirm del pago, alargar, cancelar). Empresa de
prueba: Ana (césped) libre 9, 13-15, 18-19 · Luis (césped) 10, 16-19 · Pepe (sin césped) 7-8 ·
dueña sin trabajar 11-12. Trabajo de 2 horas.

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F4-01 | Horas que ofrece la empresa | Las de quien puede hacer el trabajo **entero**: 13, 14, 16, 17, 18 | ✅ F4.1 |
| F4-02 | Ana 9 + Luis 10; Pepe (sin el servicio); dueña que no trabaja | No cuentan | ✅ F4.1 |
| F4-03 | Listado: empresa junto al autónomo | Elegible, con su primer hueco | ✅ F4.1 |
| F4-04 | El directorio dice que es empresa | `provider_kind = company` | ✅ F4.1 |
| F4-05 | **Pagar a las 13 (reserva de punta a punta, con el cobro simulado como el webhook de Stripe)** | Reserva de la empresa, horas de Ana | ✅ F4.1 |
| F4-06 | Dónde se ocupan las horas | En la agenda de Ana, no en la de la empresa | ✅ F4.1 |
| F4-07 | Horas después de esa venta | Ya no 13 ni 14 | ✅ F4.1 |
| F4-08 | Tres clientes a la misma hora con dos personas libres | Luis, Ana, y el tercero no puede | ✅ F4.1 |
| F4-09 | Misma persona, misma hora, dos ventas | Nunca | ✅ F4.1 |
| F4-10 | Mientras alguien paga | Ese hueco no se ofrece | ✅ F4.1 |
| F4-11 | El pago caduca | El hueco vuelve | ✅ F4.1 |
| F4-12 | Alargar una hora | En la agenda de quien va | ✅ F4.1 |
| F4-13 | Cancelar | Libera las horas de quien iba | ✅ F4.1 |
| F4-14 | Trabajo con carnet (D4) | Solo cuenta quien lo tiene | ✅ F4.1 |
| F4-15 | Modo «yo elijo quién va» | Solo lo cambia el dueño; la persona queda como propuesta | ✅ F4.1 |
| F4-16 | Empresa no activa | Sin horas | ✅ F4.1 |
| F4-17 | Consultar horarios del equipo o apartar a alguien desde fuera | Denegado | ✅ F4.1 |
| F4-18 | Precio y gastos de gestión (12,5 %, D1) con la misma configuración que un autónomo | Idénticos | ✅ F4.1 |
| F4-19 | Servicio activo que nadie del equipo hace (D5); luego se le asigna a uno | Sin horas; luego las suyas | ✅ F4.1 |
| F4-20 | Dueño que trabaja y hace el servicio (D3) | Sus horas se venden | ✅ F4.1 |
| F4-21 | Un empleado cambia los precios de su empresa | No cambia nada | ✅ F4.1 |
| F4-22 | No regresión del autónomo: F1 13/13 y las 7 baterías de `scripts/readiness/` | Mismos resultados que antes de F4 | ✅ F4.1 (las 9 que fallan ya fallaban antes, H-27) |

**Web (F4.2)** — en el navegador, móvil (375 px), con la empresa demo (Lucía con horario cargado a
mano: los horarios del equipo son de F5):

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F4-23 | El cliente reserva césped en Marbella: en el listado salen el autónomo y la empresa, **con el distintivo «Empresa»** y el mismo precio | Correcto | ✅ F4.2 |
| F4-24 | El calendario de la empresa muestra los días y horas de su equipo | Días de Lucía, 09:00… | ✅ F4.2 |
| F4-25 | Resumen y paso al pago | La empresa, 50,63 €, 5,63 € de gestión hoy | ✅ F4.2 |
| F4-26 | Al abrir el pago, el servidor aparta a Lucía; el aviso de Stripe (simulado: no se introducen tarjetas) crea la reserva | Reserva de la empresa, 10:00 con Lucía | ✅ F4.2 |
| F4-27 | La empresa ve «Solicitudes (1)» en su panel, la abre (misma pantalla que un autónomo) con «Va: Lucía Martín» y la acepta | Confirmada | ✅ F4.2 |
| F4-28 | «Reservas» de la empresa: la reserva confirmada con «Va: Lucía Martín», «Cobrarás 45 €», llamar y chat | Correcto | ✅ F4.2 |
| F4-29 | «Tu empresa» → «¿Quién va a cada trabajo?»: cambiar entre «GarSer elige» y «Yo elijo quién va» | Se guarda | ✅ F4.2 |

> Del plan original: «Empleado leyendo `gardener_service_prices` → denegado» se cambió por F4-21:
> los precios activos son **públicos a propósito** (el listado los lee); lo que importa es que
> nadie del equipo pueda cambiarlos.

---

### F5 — Asignar y ejecutar

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F5-01 | Empleado asignado ve la dirección del cliente | La ve | ✅ F5.2 |
| F5-02 | **Empleado ve la PII de un trabajo de su empresa pero no suyo** | Denegado | ✅ F5.2 (y ni el asignado lee la reserva completa en la tabla) |
| F5-03 | Tras desasignarle, deja de ver esa PII | Inmediato, sin limpieza manual | ✅ F5.2 |
| F5-04 | Empleado intenta cancelar una reserva | Denegado | ✅ F5.2 |
| F5-05 | Empleado marca ~~inicio y~~ fin de su trabajo | Permitido; un compañero no | ✅ F5.2 (en GarSer no existe «marcar inicio», tampoco para autónomos: el servicio empieza a su hora) |
| F5-06 | Asignar trabajo fitosanitario convencional a empleado sin carnet (D4) | No aparece en la lista; imposible asignarlo también por API | ✅ F5.2 |
| F5-07 | Desactivar a un empleado con trabajos futuros | **Bloqueado** hasta reasignar | ✅ F5.2 |
| F5-08 | Email al empleado al ser asignado | Llega (simulado en local; real en P-F5-3) | ✅ F5.4 |
| F5-09 | Al asignar un trabajo de setos, la lista solo muestra empleados que hacen setos (D5) | Solo esos | ✅ F5.2 (con césped) |
| F5-10 | Asignar por API a un empleado que no hace ese servicio (D5) | Rechazado por el servidor, no solo oculto en pantalla | ✅ F5.2 |
| F5-11 | El cliente ve nombre y foto del trabajador **el día antes** (D6) | Sí («Ana G.» y foto) | ✅ F5.4 (API y navegador) |
| F5-12 | El cliente intenta ver quién va **dos días antes**, o ver su teléfono (D6) | No lo ve; tampoco el id en la agenda (H-28) | ✅ F5.4 |

**Cliente y correos (F5.4)** — `node scripts/garser-empresas/verify-f5-client.mjs` (7
comprobaciones): F5-08, F5-11, F5-12 y F5-40 a F5-43.

**Servidor de asignación (F5.2)** — `node scripts/garser-empresas/verify-f5-assign.mjs` (13
comprobaciones, con el token de cada persona): F5-01 a F5-07, F5-09, F5-10 y F5-32 a F5-35.

**Horarios del equipo (F5.1)** — `node scripts/garser-empresas/verify-f5-schedules.mjs` (9
comprobaciones con el token de cada persona) y navegador:

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F5-20 | Un empleado pone su horario; intenta tocar el de un compañero | El suyo sí; el ajeno, denegado | ✅ F5.1 |
| F5-21 | Un empleado guarda un horario fijo | Se generan sus horas | ✅ F5.1 |
| F5-22 | Quien tiene horas vendidas las vuelve a marcar libres (guardando el día o a mano) | Siguen ocupadas (H-29) | ✅ F5.1 |
| F5-23 | Regenerar su horario fijo | Tampoco las reabre | ✅ F5.1 |
| F5-24 | Horas de esa persona para vender | Sin las vendidas | ✅ F5.1 |
| F5-25 | El dueño que trabaja regenera su horario con trabajos de su equipo confirmados | No se le cierran sus horas (H-29) | ✅ F5.1 |
| F5-26 | Horas ocupadas propias / de un compañero | Las suyas sí; las del compañero no | ✅ F5.1 |
| F5-27 | Cancelar | Libera las horas de quien iba | ✅ F5.1 |
| F5-28 | Antelación mínima de la empresa; un empleado intenta cambiarla | Se aplica a la venta; no la cambia | ✅ F5.1 |
| F5-32 | Cambiar quién va | Quien iba queda libre; quien va, ocupado; todo o nada | ✅ F5.2 |
| F5-33 | Confirmar la propuesta (misma persona) | Deja de ser propuesta | ✅ F5.2 |
| F5-34 | Detalle del trabajo (qué hay que hacer) | Lo ve quien va; un compañero no | ✅ F5.2 |
| F5-35 | Asignar a alguien ocupado alguna de las horas | Rechazado con explicación; nada cambia | ✅ F5.2 |
| F5-36 | Navegador (móvil): «Mi trabajo» del empleado en pestañas Hoy / Semana / Perfil; «Hoy» sin trabajos avisa de los de la semana | Correcto | ✅ F5.3 |
| F5-37 | Navegador: en «Semana», el trabajo con fecha, hora, dirección, cliente, «Cómo llegar», «Llamar» y «Qué hay que hacer» (detalle del servicio) | Correcto | ✅ F5.3 |
| F5-38 | Navegador: la dueña, en «Reservas», pulsa «Cambiar quién va»: salen Lucía («Va ahora») y ella («Libre»); elige y la tarjeta pasa a «Va: tú» | Correcto, y en la base de datos | ✅ F5.3 |
| F5-39 | Navegador: «Horario fijo» sin el bucle de pintado previo (H-30) | Sin errores en consola | ✅ F5.3 |
| F5-40 | Reserva aún sin aceptar por la empresa | El cliente no ve quién va | ✅ F5.4 |
| F5-41 | Reserva con un autónomo | No aplica | ✅ F5.4 |
| F5-42 | Cambiar quién va en un trabajo confirmado | Aviso a quien deja de ir y a quien va; no se puede «desavisar» a quien va ni a alguien de fuera | ✅ F5.4 |
| F5-43 | Trabajo aún sin aceptar | No genera aviso | ✅ F5.4 |
| F5-44 | Navegador (móvil), cliente: la tarjeta dice «con Jardines Demo Costa», «Irá Marta D.» el día antes y «Hablar con Jardines Demo Costa» (H-31) | Correcto | ✅ F5.4 |
| F5-29 | Navegador (móvil): el empleado abre «Mi horario» desde «Mi trabajo» y ve su hora vendida como «Reservado» | Correcto | ✅ F5.1 |
| F5-30 | Navegador: en «Horario fijo» el empleado no ve la antelación mínima | Correcto | ✅ F5.1 |
| F5-31 | Navegador: la dueña que trabaja tiene «Mi horario» en su tarjeta, y cambia la antelación de la empresa en «Tu empresa» | Se guarda | ✅ F5.1 |

---

### F6 — Planificación y reasignación

**Servidor (F6.1)** — `node scripts/garser-empresas/verify-f6-planning.mjs` (12 comprobaciones).
**Mover de fecha (F6.3)** — `node scripts/garser-empresas/verify-f6-reschedule.mjs` (9 comprobaciones).
No regresión: F1 13/13, F4 21/21, F5 29/29 y las 7 baterías de servicios iguales que antes.

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F6-01 | Reasignar a alguien libre | Correcto; quienes iban quedan libres | ✅ F6.1 |
| F6-02 | Reasignar a alguien ocupado | Rechazado, con mensaje entendible | ✅ F6.1 («no está libre a las 10:00») |
| F6-03 | El conflicto se avisa **antes** de confirmar | Se ve antes | ✅ F6.2 («Lucía Martín (ocupado)» deshabilitada en la hoja del trabajo) |
| F6-04 | Mover un trabajo de fecha | Libera las viejas y ocupa las nuevas, o ninguna de las dos | ✅ F6.3 (con propuesta al cliente, D9) |
| F6-05 | Dividir un trabajo entre dos personas | El total de horas no varía | ✅ F6.1 (por tramos, D10) |
| F6-30 | Horas a las que se podría mover | Las de quien puede hacerlo entero (o por turnos si se aceptan) | ✅ F6.3 |
| F6-31 | Proponer | Solo el dueño; solo a una franja en la que alguien puede | ✅ F6.3 |
| F6-32 | Aviso de la propuesta al cliente | Una sola vez; solo lo pide la empresa | ✅ F6.3 |
| F6-33 | El cliente rechaza (y otro cliente intenta responder) | No cambia nada, no se cancela; el otro, denegado | ✅ F6.3 |
| F6-34 | Aviso del rechazo | A la empresa | ✅ F6.3 |
| F6-35 | Aviso de la aceptación | A la empresa y a quien va | ✅ F6.3 |
| F6-36 | Aceptar cuando ya no hay nadie libre | No se mueve nada; la propuesta caduca | ✅ F6.3 |
| F6-37 | Propuesta de más de 48 h | Caducada | ✅ F6.3 |
| F6-38 | Navegador (móvil): Marta abre el trabajo → «Mover a otra fecha» → elige día, ve las horas posibles, motivo → «Proponer»; Laura ve el aviso en su inicio y pulsa «Aceptar nueva fecha» | La reserva pasa al miércoles 30 con Lucía; avisos a la empresa y a Lucía | ✅ F6.3 |
| F6-19 | Navegador: el panel de la empresa abre en **Agenda** (Día / Semana / Lista) | Correcto | ✅ F6.2 |
| F6-20 | Navegador: Semana → tocar el martes → Día; tocar el trabajo → hoja; «todo a Marta» → guardar | Reasignado; Lucía queda libre | ✅ F6.2 |
| F6-21 | Navegador: barra inferior del empleado | «Mi trabajo · Horario · Cuenta» (antes llevaba a reservas de cliente) | ✅ F6.2 |
| F6-10 | Sin «aceptar trabajos partidos» (por defecto) | Solo se vende si una persona hace el trabajo entero | ✅ F6.1 |
| F6-11 | Con el ajuste encendido (solo lo cambia el dueño) | Se vende por turnos | ✅ F6.1 |
| F6-12 | Venta por turnos | Cada hora a una persona; sus agendas, ocupadas | ✅ F6.1 |
| F6-13 | Cada persona de un trabajo repartido | Ve el trabajo con **sus** horas | ✅ F6.1 |
| F6-14 | Alargar un trabajo repartido | Lo alarga quien hace la última hora | ✅ F6.1 |
| F6-15 | Repartir sin decir quién hace cada hora / que lo intente un empleado | Rechazado | ✅ F6.1 |
| F6-16 | Agenda de la empresa (`company_schedule`) | Equipo, horas libres y trabajos con quién hace cada hora; solo el dueño; máximo un mes | ✅ F6.1 |
| F6-17 | Acortar un trabajo repartido | Libera la hora a quien la tenía | ✅ F6.1 |
| F6-18 | Confirmarse un trabajo repartido | Cada persona recibe su aviso con «Tu parte» | ✅ F6.1 |
| F6-06 | **Planificación con 20 empleados en móvil de 375 px** | Sin scroll horizontal ni texto cortado | ✅ F6.2 (empresa temporal de 20 con nombres largos, `seed-f6-big-team.mjs`; tras permitir que los nombres partan línea: 0 textos cortados, ancho 375) |
| F6-07 | Panel de empleado legible al sol, sin ampliar | Manual, en móvil real | ⬜ |

---

### F7 — Varios trabajadores y varios días

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F7-01 | Trabajo de 8 h de mano de obra con 2 personas | 4 h de reloj, 8 filas de bloques | ✅ F7.1 (4 h de reloj, 8 filas: Ana y Luis de 8 a 12) |
| F7-02 | Ese trabajo cuesta **lo mismo** que con una persona | Precio idéntico | ✅ F7.2 (216 € con 2 personas en 4 h y con 1 en 8 h) |
| F7-03 | Se descuentan 4 h a cada empleado, no 8 | Correcto | ✅ F7.1 |
| F7-04 | Trabajo de 40 h en 5 días con 2 personas distintas | Se crea | ✅ F7.1 (del día 5 al 10, saltando el 7 sin nadie) |
| F7-05 | Ninguna jornada supera las 12 h | Los 7 guardas siguen válidos | ✅ F7.1 |
| F7-06 | El cliente ve «del 5 al 9 de mayo» | Correcto | ⬜ |
| F7-07 | Trabajo de 2 personas con solo 1 libre | No reservable | ✅ F7.1 (el pago lo rechaza) |
| F7-08 | La web y el pago dicen lo mismo | Con horarios al azar, las horas que ofrece la web = las que el pago puede apartar | ✅ F7.2 (72 combinaciones) |
| F7-21 | La web ofrece un trabajo de 8 h con dos personas a la vez | Con límite 1, ninguna hora; con 2, sí | ✅ F7.2 |
| F7-22 | Presupuesto de la web → pago → reserva de equipo | 4 h de reloj, 8 de trabajo | ✅ F7.2 |
| F7-23 | Trabajo de 36 h en la web | Presupuesto «del día 30 al 35», saltando el día sin nadie | ✅ F7.2 |
| F7-24 | Pagar ese trabajo | Reserva de varios días | ✅ F7.2 |
| F7-25 | Sin días suficientes en 3 semanas | No se ofrece | ✅ F7.2 |
| F7-26 | Autónomo, trabajo de 18 h (antes imposible, T7) | Se ofrece y se reserva en 2 días | ✅ F7.2 |
| F7-10 | Límite de personas a la vez | Solo lo cambia el dueño (1–10); lo ve en su panel | ✅ F7.1 |
| F7-11 | Límite 1 frente a límite 2 | Con 1, un trabajo de 8 h sin nadie con 8 h libres no cabe; con 2, van dos a la vez | ✅ F7.1 |
| F7-12 | Trabajo de equipo: repartir por horas, «todo a una persona», alargar | Rechazados | ✅ F7.1 |
| F7-13 | Cambiar a una persona por otra en todo el trabajo | Solo el dueño y solo si la nueva está libre en todas sus horas; la vieja queda libre | ✅ F7.1 |
| F7-14 | El cliente ve a las dos personas (el día antes) | Correcto | ⬜ F7.3 |
| F7-15 | Mover de fecha un trabajo de equipo | Se vuelve a planificar; horas viejas libres | ✅ F7.1 |
| F7-16 | Trabajo de 12 h o menos | Nunca en varios días | ✅ F7.1 |
| F7-17 | Agendas de empleado y empresa con un trabajo que empezó antes | Se ve, con fin y horas por día | ✅ F7.1 |
| F7-18 | Aviso de «¿se hizo el trabajo?» en varios días | Tras el último día | ✅ F7.1 |
| F7-19 | Cancelar un trabajo de varios días | Libres todos los días | ✅ F7.1 |
| F7-20 | Autónomo con un trabajo de 16 h (D12) | 2 días, él solo | ✅ F7.1 |

---

### F8 y F9 — Multi-servicio y mantenimiento

*Se detallan al llegar. Nota previa: F8 toca también a los autónomos, así que su batería de
no regresión es más amplia que la de las fases de empresa.*

---

## 3. Batería de producción (`garser.es`)

Se rellena al cerrar cada fase, traduciendo las pruebas de arriba a lo que hay que
comprobar en producción. **Se ejecuta una sola vez, el día de la fusión final**: el proyecto
no sale a producción antes (ver `01-PLAN-Y-PROGRESO.md` §0).

| # | Prueba en producción | Fase origen | Estado |
|---|---|---|---|
| P-F0-1 | Tras aplicar la migración: registrarse con un correo nuevo y comprobar en el SQL Editor que tiene fila en `profiles` con rol `client` | F0 | ⬜ |
| P-F0-2 | Registrarse como jardinero → fila en `profiles` con rol `gardener` | F0 | ⬜ |
| P-F0-3 | Consulta 1 de `01-PLAN-Y-PROGRESO.md` §5b: solo aparece el admin legítimo | F0 | ⬜ |
| P-F0-4 | `select count(*) from auth.users u where not exists (select 1 from profiles p where p.user_id=u.id)` → 0 | F0 | ⬜ |
| P-F0-5 | Entrar como jardinero aprobado en el móvil: la barra inferior dice «Panel» | F0 | ⬜ |
| P-F0-6 | Panel de admin → Usuarios → Monitor de Roles: 0 inconsistencias, y ningún jardinero pendiente marcado | F0 | ⬜ |
| P-F1-1 | **Justo tras migrar:** hacer una reserva real pagada con Stripe (modo prueba) y comprobar en el SQL Editor que sus filas de `booking_blocks` tienen `assignee_id` = el jardinero | F1 | ⬜ |
| P-F1-2 | El jardinero propone una hora más en una reserva pendiente y el cliente acepta: la reserva se confirma y la agenda crece | F1 | ⬜ |
| P-F1-3 | Cancelar esa reserva: las horas vuelven a estar libres en la web | F1 | ⬜ |
| P-F1-4 | `select count(*) from booking_blocks where assignee_id is null` → 0 | F1 | ⬜ |
| P-F2-1 | Con una cuenta de cliente, intentar crear una ficha de proveedor por la API (`POST /rest/v1/gardener_profiles`) | F2 | ⬜ → debe dar 403 |
| P-F2-2 | Con una cuenta de jardinero, intentar cambiar `license_verification_status` por la API | F2 | ⬜ → debe dar 403 |
| P-F2-3 | El admin aprueba una solicitud de jardinero real: aparece su ficha y puede configurar precios | F2 | ⬜ |
| P-F2-4 | Un jardinero edita su perfil (descripción, zona) desde la web y se guarda | F2 | ⬜ |
| P-F3-1 | Un jardinero sube un carnet nuevo desde su panel: queda **pendiente** y el admin lo ve para revisar | F3 | ⬜ |
| P-F3-2 | Intentar crear por la API una licencia con `status: approved` | F3 | ⬜ → debe dar 403 |
| P-F3-3 | Registrarse en `garser.es` como empresa, rellenar la encuesta en el móvil y enviarla | F3 | ⬜ |
| P-F3-4 | Como admin, aprobar esa empresa desde Usuarios → Solicitudes de Empresas; la empresa entra en su panel | F3 | ⬜ |
| P-F3-5 | Rechazar otra con motivo; la empresa lo ve y puede corregir y reenviar | F3 | ⬜ |
| P-F3-6 | La empresa aprobada invita a un correo real; desde otro móvil, abrir el enlace, crear la cuenta, **confirmar el correo** y comprobar que al entrar se retoma la invitación y se acepta | F3 | ⬜ |
| P-F3-7 | El empleado sube su carnet; el admin lo ve con «· empleado de <empresa>» y lo aprueba; la empresa le asigna fitosanitarios | F3 | ⬜ |
| P-F3-8 | Por la API, con una cuenta de cliente, llamar a `has_valid_phyto_license` con el id de otra persona | F3 | ⬜ → debe dar 403 |
| P-F3-9 | La empresa invita a un correo real: el correo llega (revisar también la carpeta de spam), con el nombre de la empresa, y su botón abre la invitación | F3 | ⬜ |
| P-F3-10 | El admin aprueba una empresa: le llega «Tu empresa ya está dada de alta en GarSer» y el botón lleva a su panel | F3 | ⬜ |
| P-F3-11 | El admin rechaza otra con motivo: le llega el correo con ese motivo y el botón «Corregir y enviar de nuevo» | F3 | ⬜ |
| P-F4-1 | Con la empresa de prueba y un empleado con horario: reservar y pagar (Stripe en modo prueba) un trabajo de 2 h; comprobar en el SQL Editor que `booking_blocks.assignee_id` es el empleado y la reserva es de la empresa | F4 | ⬜ |
| P-F4-2 | Un autónomo real sigue apareciendo en el listado con sus mismas horas y precio | F4 | ⬜ |
| P-F5-1 | Un autónomo real guarda su horario de una semana en la que tiene una reserva: la hora reservada sigue «Reservado» y no se ofrece a otros clientes | F5 | ⬜ |
| P-F5-2 | Un empleado real pone su horario en «Mi trabajo» → «Semana» → «Mi horario»; la empresa recibe una reserva en esas horas y le toca a él | F5 | ⬜ |
| P-F5-3 | La empresa cambia quién va en un trabajo confirmado: a los dos les llega su correo | F5 | ⬜ |
| P-F5-4 | El cliente de esa reserva ve «Irá …» con nombre y foto el día antes, y no antes | F5 | ⬜ |
| P-F6-1 | La empresa reparte un trabajo de 3 h entre dos personas desde la agenda; a cada una le llega su aviso con «Tu parte» | F6 | ⬜ |
| P-F6-2 | La empresa propone otra fecha; al cliente le llega el correo, la acepta desde «Mis reservas» y la reserva se mueve (y le llega el aviso a quien va) | F6 | ⬜ |
| P-F7-1 | Una empresa con «hasta 2 personas a la vez» y dos empleados libres 4 h: un cliente reserva un trabajo de 8 h; sale «2 personas, 4 h», se paga y a los dos les aparece | F7 | ⬜ |
| P-F7-2 | Un trabajo grande (más de 12 h) de un autónomo: la web lo ofrece en varios días, se paga y queda «del X al Y» | F7 | ⬜ |

---

## 4. Cuentas y datos de prueba necesarios

Lo que hay que tener sembrado antes de cada bloque. **Pendiente de crear.**

| Cuenta | Para qué | Desde |
|---|---|---|
| Cliente | Funnel y no regresión | Ya existe |
| Autónomo activo | No regresión | Ya existe |
| Admin | F0 | Ya existe |
| **Empresa A** con 5 empleados | F2–F7 | F2 |
| **Empresa B** con 2 empleados | Aislamiento entre empresas (F2-02, F2-03) | F2 |
| **Empleado sin carnet** fitosanitario | F5-06 | F5 |
| **Empresa con 20 empleados** | F6-06, la prueba de móvil | F6 |

> La empresa de 20 empleados no es un capricho: la planificación en móvil se rompe con
> volumen, no con dos filas de ejemplo.
