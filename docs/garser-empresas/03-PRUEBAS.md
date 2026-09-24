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

> Las pruebas de servidor se repiten con `node scripts/garser-empresas/verify-f3-db.mjs`
> (31 comprobaciones). Las de pantallas (F3-40 a F3-50) se hicieron en el navegador.

> F3-04 es la prueba de seguridad principal de toda la fase de empresas.

---

### F4 — La empresa vende

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F4-01 | Empresa con 1 empleado disponible aparece en el funnel | Aparece | ⬜ |
| F4-02 | Empresa con 0 empleados disponibles | No aparece | ⬜ |
| F4-03 | Empresa con 5 empleados, 3 ocupados | Aparece para 1 persona | ⬜ |
| F4-04 | Precio de una empresa = precio de un autónomo con la misma configuración | Idéntico | ⬜ |
| F4-05 | Comisión del 12,5 % cobrada igual | Idéntica *(salvo D1)* | ⬜ |
| F4-06 | **Reserva completa a una empresa, de punta a punta** | Confirmada y pagada | ⬜ |
| F4-07 | En paralelo, el funnel del autónomo no ha cambiado | R-04 sigue pasando | ⬜ |
| F4-08 | Empleado leyendo `gardener_service_prices` de su empresa | Denegado | ⬜ |
| F4-09 | Empresa con 3 empleados libres, **ninguno** hace setos; cliente pide setos (D5) | La empresa **no** aparece | ⬜ |
| F4-10 | Mismo caso, uno de ellos sí hace setos | Aparece, con capacidad para 1 persona | ⬜ |
| F4-11 | Dueño que **no** trabaja y 0 empleados libres (D3) | No aparece | ⬜ |
| F4-12 | Dueño que **sí** trabaja, libre, con el servicio marcado (D3) | Aparece | ⬜ |
| F4-13 | Fitosanitario convencional: empresa cuyo único empleado fitosanitario no tiene carnet (D4) | No aparece para ese tratamiento | ⬜ |

---

### F5 — Asignar y ejecutar

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F5-01 | Empleado asignado ve la dirección del cliente | La ve | ⬜ |
| F5-02 | **Empleado ve la PII de un trabajo de su empresa pero no suyo** | Denegado | ⬜ |
| F5-03 | Tras desasignarle, deja de ver esa PII | Inmediato, sin limpieza manual | ⬜ |
| F5-04 | Empleado intenta cancelar una reserva | Denegado | ⬜ |
| F5-05 | Empleado marca inicio y fin de su trabajo | Permitido | ⬜ |
| F5-06 | Asignar trabajo fitosanitario convencional a empleado sin carnet (D4) | No aparece en la lista; imposible asignarlo también por API | ⬜ |
| F5-07 | Desactivar a un empleado con trabajos futuros | **Bloqueado** hasta reasignar | ⬜ |
| F5-08 | Email al empleado al ser asignado | Llega | ⬜ |
| F5-09 | Al asignar un trabajo de setos, la lista solo muestra empleados que hacen setos (D5) | Solo esos | ⬜ |
| F5-10 | Asignar por API a un empleado que no hace ese servicio (D5) | Rechazado por el servidor, no solo oculto en pantalla | ⬜ |
| F5-11 | El cliente ve nombre y foto del trabajador **el día antes** (D6) | Sí | ⬜ |
| F5-12 | El cliente intenta ver quién va **dos días antes**, o ver su teléfono (D6) | No lo ve | ⬜ |

---

### F6 — Planificación y reasignación

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F6-01 | Reasignar a alguien libre | Correcto | ⬜ |
| F6-02 | Reasignar a alguien ocupado | Rechazado, con mensaje entendible | ⬜ |
| F6-03 | El conflicto se avisa **antes** de confirmar | Se ve antes | ⬜ |
| F6-04 | Mover un trabajo de fecha | Libera las viejas y ocupa las nuevas, o ninguna de las dos | ⬜ |
| F6-05 | Dividir un trabajo entre dos personas | El total de horas no varía | ⬜ |
| F6-06 | **Planificación con 20 empleados en móvil de 375 px** | Sin scroll horizontal ni texto cortado | ⬜ |
| F6-07 | Panel de empleado legible al sol, sin ampliar | Manual, en móvil real | ⬜ |

---

### F7 — Varios trabajadores y varios días

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F7-01 | Trabajo de 8 h de mano de obra con 2 personas | 4 h de reloj, 8 filas de bloques | ⬜ |
| F7-02 | Ese trabajo cuesta **lo mismo** que con una persona | Precio idéntico | ⬜ |
| F7-03 | Se descuentan 4 h a cada empleado, no 8 | Correcto | ⬜ |
| F7-04 | Trabajo de 40 h en 5 días con 2 personas distintas | Se crea | ⬜ |
| F7-05 | Ninguna jornada supera las 12 h | Los 7 guardas siguen válidos | ⬜ |
| F7-06 | El cliente ve «del 5 al 9 de mayo» | Correcto | ⬜ |
| F7-07 | Trabajo de 2 personas con solo 1 libre | No reservable | ⬜ |

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
