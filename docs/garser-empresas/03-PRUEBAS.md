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
| R-01 | `npm test` ≥ 462 en verde | Automático | ✅ F0-servidor: 462 |
| R-02 | `npm run build` pasa | Automático | ✅ F0-servidor |
| R-03 | `npm run typecheck` no sube de 130 | Automático, informativo | ✅ F0-servidor: 130 |
| R-04 | Funnel completo de autónomo: servicio → fotos → precio → profesional → fecha → comisión → confirmación | Manual, en local | ⬜ |
| R-05 | Reserva de autónomo: las horas se bloquean y se liberan igual que antes | Manual + SQL | ⬜ |
| R-06 | Cambio de precio **con cambio de duración** aceptado: la agenda se redimensiona | Manual | ⬜ |
| R-07 | Cancelación con política de 24 h | Manual | ⬜ |
| R-08 | Incidencia y no-show | Manual | ⬜ |
| R-09 | Cada tipo de cuenta entra a su panel: cliente, autónomo, admin | Manual, 3 cuentas | ⬜ |
| R-10 | Un autónomo sin empresa no ve **nada** de empresas en ninguna pantalla | Manual | ⬜ |

> R-06 es nueva respecto a auditorías anteriores: `resize_booking_schedule()` es de
> 2026-09-13 y toca la misma agenda que la Fase 1. Ver hallazgo H-03.

---

## 2. Pruebas por fase

### F0 — Fuente única de rol

*Objetivo: cero cambios visibles.*

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F0-01 | Cliente entra en `/dashboard` | Panel de cliente | ⬜ |
| F0-02 | Autónomo activo entra en `/dashboard` | Panel de jardinero | ⬜ |
| F0-03 | Autónomo con solicitud pendiente | Redirige a `/status` | ⬜ |
| F0-04 | Autónomo con solicitud denegada | Redirige a `/status` con el motivo | ⬜ |
| F0-05 | Usuario con intención de jardinero sin solicitud | Redirige a `/apply` | ⬜ |
| F0-06 | Admin entra en `/dashboard` | Redirige a `/admin/dashboard` | ⬜ |
| F0-07 | Borrar `localStorage` y recargar estando logueado | El rol se resuelve igual | ⬜ |
| F0-08 | Poner `localStorage.signup_role = 'gardener'` en una cuenta de cliente | **Se ignora.** Sigue siendo cliente | ⬜ |
| F0-09 | `UPDATE profiles SET role='admin'` desde el cliente vía PostgREST | Denegado | ✅ ya hoy (2026-09-23): lo bloquea `prevent_role_escalation` |
| F0-10 | **Cuenta nueva registrada por API crea su perfil con `role='admin'`** (H-11) | Denegado | ✅ 2026-09-23 — HTTP 403 con y sin perfil previo (antes de la migración: HTTP 201) |
| F0-11 | Cuenta nueva registrada por la web **tiene perfil** nada más registrarse (H-12) | Perfil creado por el servidor | ✅ 2026-09-23 (registro por API; por la web, en la parte frontend) |
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
| F1-00 | **Antes de migrar:** consultar solapes existentes en `booking_blocks` | Cero. Si no, son dobles reservas reales que resolver a mano | ⬜ |
| F1-01 | Tras el relleno, ningún `assignee_id` a `NULL` | `COUNT(*) WHERE assignee_id IS NULL` = 0 | ⬜ |
| F1-02 | `COUNT(*)` de `booking_blocks` idéntico antes y después | Mismo número | ⬜ |
| F1-03 | Crear una reserva de autónomo | Bloques con `assignee_id` = el autónomo | ⬜ |
| F1-04 | Cancelar esa reserva | Las horas vuelven a estar libres | ⬜ |
| F1-05 | Aceptar un cambio de duración que **alarga** con horas libres | La agenda se redimensiona | ⬜ |
| F1-06 | Aceptar un cambio de duración que alarga **sin** horas libres | Falla entero, no deja nada a medias | ⬜ |
| F1-07 | Dos reservas simultáneas sobre la misma hora, **en paralelo de verdad** | Una gana, la otra recibe error claro | ⬜ |
| F1-08 | Insertar a mano un bloque duplicado `(assignee, date, hour)` | Rechazado por el índice único | ⬜ |

> F1-07 hay que ejecutarla en paralelo real, no en secuencia. En secuencia pasa siempre y no
> prueba nada.

---

### F2 — Modelo de proveedor y RLS

*Se prueba contra la API, nunca contra la interfaz.*

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F2-01 | Todos los `gardener_profiles` existentes quedan con `provider_kind='solo'` | Sin excepciones | ⬜ |
| F2-02 | Empleado de la empresa A consulta `company_members` de la B | Cero filas | ⬜ |
| F2-03 | Empleado consulta `companies` de otra empresa | Cero filas | ⬜ |
| F2-04 | Empleado intenta escribir en `companies` de la suya | Denegado | ⬜ |
| F2-05 | Cliente consulta `company_members` | Cero filas | ⬜ |
| F2-06 | Las policies nuevas no provocan recursión | Las consultas responden, no dan error de profundidad | ⬜ |

---

### F3 — Alta de empresa y empleados

| # | Prueba | Resultado esperado | Estado |
|---|---|---|---|
| F3-01 | Aceptar invitación con token válido | Se crea `company_members`, rol `employee` | ⬜ |
| F3-02 | Aceptar con token caducado | Rechazado | ⬜ |
| F3-03 | Aceptar dos veces el mismo token | La segunda, rechazada | ⬜ |
| F3-04 | **Aceptar con `company_id` manipulado en la petición** | Se ignora; se usa el del token | ⬜ |
| F3-05 | Un autónomo activo acepta una invitación de empleado | Bloqueado, con explicación | ⬜ |
| F3-06 | El token no aparece en claro en la base de datos | Solo el hash | ⬜ |
| F3-07 | Empleado intenta crearse un `gardener_profiles` | Denegado | ⬜ |
| F3-08 | Empleado no aparece en `public_gardener_directory` | Cero filas | ⬜ |
| F3-09 | Empresa recién registrada, **sin aprobar** por el admin (D2) | No aparece en el funnel ni puede recibir reservas | ⬜ |
| F3-10 | El admin ve la solicitud de empresa **en su propia sección**, con las respuestas de la encuesta de empresa (D2) | Separada de las de jardineros | ⬜ |
| F3-11 | Marcar a un empleado un servicio que la empresa **no** tiene activo (D5) | No se permite | ⬜ |
| F3-12 | Activar «Servicios fitosanitarios» a un empleado **sin carnet** adjuntado y aprobado (D4) | No se permite | ⬜ |
| F3-13 | Empleado con carnet **caducado** | Se le desactiva el servicio fitosanitario | ⬜ |
| F3-14 | Dueño activa y desactiva «Yo también trabajo» (D3) | Aparece y desaparece de la lista de su equipo como trabajador | ⬜ |

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
