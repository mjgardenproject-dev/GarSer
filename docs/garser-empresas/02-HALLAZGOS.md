# GarSer Empresas — Hallazgos y decisiones

> Dos cosas en un fichero: **lo que se ha descubierto mirando el código** y **lo que ya se ha
> decidido**, para no volver a discutirlo.
>
> Regla de la casa: un hallazgo sin `fichero:línea` no es un hallazgo, es una sospecha.
> Las sospechas van a §3.

**Última actualización:** 2026-09-23 (decisiones D1–D6)

---

## 1. Hallazgos verificados

Comprobados contra `/Users/javier/Downloads/GarSer-main 4` el 2026-09-20, sobre `main` en el
commit `ed9fd6b`. **Revalidados el 2026-09-23 sobre `origin/main` `6eef75c`** (tras el merge
#34, que no toca SQL ni Edge Functions): mismos resultados y mismas líneas en todos.

---

### H-01 · Hay dos tablas de disponibilidad y el frontend solo usa una — 🟢 Resuelto en F1 (ver actualización al final)

**Qué pasa.** Existen `availability` (rangos) y `availability_blocks` (una fila por hora).
Las RPC mantienen **las dos** en paralelo. Pero:

- `booking-authority/index.ts:294` — el funnel lee **`availability`**, no `availability_blocks`.
- `booking-payment/index.ts:520` — también `availability`.
- `availabilityServiceCompat.ts` — ocho consultas, todas a `availability`.
- **`availability_blocks` no la lee ningún fichero TypeScript.** Solo la escriben las RPC.

**Por qué importa.** Es una proyección que nadie consume y que hay que mantener sincronizada
en cada escritura de agenda. Hoy el coste es una escritura de más. **Con empresas, ese coste
se multiplica por el número de empleados**, y cada punto de sincronización es un sitio donde
la disponibilidad mostrada puede dejar de ser la real.

**Decisión que hay que tomar en F1** (técnica, la toma el chat y la documenta aquí):

- **Opción A — consolidar en `availability`.** Es la que ya lee todo el mundo. Se deja de
  escribir en `availability_blocks` y se retira. Menos código, un solo sitio.
- **Opción B — consolidar en `availability_blocks`.** Es el modelo correcto por hora, pero
  obliga a migrar el funnel, el pago y la capa de compatibilidad.
- **Opción C — mantener las dos.** Lo que hay hoy. Es la opción de menos riesgo inmediato y
  más deuda.

**Recomendación:** A. La granularidad horaria ya existe de facto — `booking-authority`
extrae la hora de `start_time`. `availability_blocks` no aporta nada que `availability` no
dé, y es la que nadie lee.

**Ojo:** `availability` **no tiene clave ajena** sobre `gardener_id`, así que un empleado
(que no está en `gardener_profiles`) puede tener filas ahí sin cambiar el esquema. Esto es
lo que hace viable el modelo de capacidad por empleado.

**Actualización F1 (2026-09-23) — la premisa estaba incompleta y el fallo era real.**
«Nadie lee `availability_blocks`» solo era cierto para el código TypeScript. En SQL la leían
`reserve_booking_schedule`, `resize_booking_schedule` y `generate_recurring_slots`, y el
comentario de `resize` la llamaba «la fuente canónica»: **dos partes del sistema no se ponían
de acuerdo sobre qué tabla manda**. Consecuencia demostrada (pruebas F1-05 y F1-10 en rojo
antes del arreglo): en un día sin filas en `availability_blocks` (fuera de la ventana del
generador nocturno, o con disponibilidad puesta a mano) **la web ofrecía una hora que el
jardinero luego no podía aceptar ni alargar** («no tiene libres las horas»). Tras
`supabase db reset` la tabla queda vacía (la semilla no la rellena), y así apareció.

**Resuelto (opción A, parcial y reversible):** `reserve` y `resize` deciden ahora con
`availability` y con el mismo criterio que `confirm_booking_payment_attempt`
(`count_distinct_available_legacy_hours` + bloqueo `FOR UPDATE`). **`availability_blocks` se
sigue escribiendo** en todas partes como espejo, pero ya no decide nada en la agenda. Solo
la lee `generate_recurring_slots`. Retirarla del todo queda para cuando se construya
`provider_free_hours` (F4), que tiene que elegir una única fuente: A-16.

---

### H-02 · El tope de 12 horas está replicado en siete funciones SQL — 🔴 Afecta a F7

**Evidencia.** `IF p_duration_hours IS NULL OR p_duration_hours < 1 OR p_duration_hours > 12`:

| Migración | Línea |
|---|---|
| `20260513000000_atomic_booking_flow.sql` | 50 |
| `20260514090000_booking_request_lifecycle_rpc.sql` | 308 |
| `20260515103000_booking_authority_foundations.sql` | 116 y 347 |
| `20260518120000_authoritative_quote_availability_contract.sql` | 54 |
| `20260518151000_booking_payment_confirm_and_hold_guards.sql` | 349 |
| `20260518170000_task4_booking_broadcast_security_hardening.sql` | 164 |

Y además `bookings_proposed_duration_hours_check` en `20260913121000`, con el mismo tope.

**Por qué importa.** **GarSer no puede vender hoy un trabajo de 40 horas.** No es que falte
la pantalla: es que las siete vías de creación lo rechazan. Es la palanca de ingresos de la
que habla §1 del plan, cerrada con llave.

**Decisión tomada.** *No se levanta el tope.* En su lugar se separan dos magnitudes:

- `duration_hours` = **span de la jornada**. Sigue con tope de 12 h. Los siete guardas
  siguen siendo correctos y no se tocan.
- **Mano de obra total** = número de filas en `booking_blocks`. Sin tope, repartida entre
  fechas y personas.

Así un trabajo de 40 h son 5 jornadas de 8 h, cada una válida bajo el guarda existente.
Levantar el tope habría obligado a revisar siete funciones críticas de dinero y agenda.

---

### H-03 · `resize_booking_schedule()` es una tercera función que escribe la agenda — 🟠 Afecta a F1

**Evidencia.** `supabase/migrations/20260913121000_price_change_duration_change.sql`.
Es de **2026-09-13**, posterior a la auditoría de arquitectura.

Escribe en `booking_blocks`, `availability_blocks` y `availability` (7 apariciones de
`availability_blocks` solo en esa migración). El jardinero puede proponer un cambio de
duración junto al de precio; al aceptarlo, la agenda se redimensiona.

**Por qué importa.** El plan original citaba dos funciones a modificar en F1
(`reserve_` y `release_`). **Son tres.** Si se olvida, un cambio de duración aceptado dejaría
bloques sin `assignee_id` y rompería el índice único.

**También relevante para empresas:** el redimensionado falla entero si las horas de más no
están libres, sin dejar nada a medias. Es el comportamiento correcto y hay que conservarlo
cuando el redimensionado afecte a varios empleados.

---

### H-04 · Carnet fitosanitario: quién debe tenerlo, la empresa o quien aplica — 🟢 Resuelto por D4 (2026-09-23)

**Qué hay.** `20260913120000_phytosanitary_license_active_gate.sql` pone
`has_phytosanitary_license` en `gardener_profiles` cuando la licencia se aprueba
(`:80-81`), y el funnel filtra por esa bandera.

**El problema.** Con empresas, esa bandera cuelga del **proveedor**, es decir, de la empresa.
Pero el RD 1311/2012 exige el carnet a **la persona que aplica el producto**, no a la
sociedad que la emplea. Una empresa con licencia que asigna a un empleado sin carnet estaría
incumpliendo, y GarSer habría facilitado la asignación.

**Esto no es una decisión técnica.** Es D4 en el plan y la tiene que responder el usuario,
idealmente confirmándolo con alguien que conozca la normativa.

**Lo que hay que prever técnicamente, decida lo que decida:** la asignación de un trabajo
fitosanitario con producto convencional debe poder comprobar la licencia **del empleado
asignado**, no solo la del proveedor. Conviene que `gardener_licenses` pueda colgar también
de un empleado — hoy su clave ajena apunta a `gardener_profiles.user_id`.

**Resolución (D4, 2026-09-23).** El usuario decide que **cada empleado adjunta su propio
carnet**. El de la empresa no cubre a sus empleados. Diseño resultante en **A-13**.

---

### H-05 · El frontend no lee `booking_blocks` en absoluto — 🟢 Buena noticia para F1

`BookingRequestsManager.tsx:227` **construye un array sintético** de un solo elemento; no
consulta la tabla. Lo dice su propio comentario en `:516-520` (hallazgo T6 de una auditoría
anterior).

**Consecuencia:** la Fase 1 es casi enteramente SQL. La superficie de frontend a revisar es
un fichero, y ni siquiera lee la tabla. Reduce mucho el riesgo estimado de esa fase.

---

### H-06 · El rol se resuelve desde cinco fuentes — 🔴 Bloquea todo · Es la F0

8 apariciones de `signup_role` / `user_metadata.role` / `requested_role` en `src/App.tsx`,
más las de `src/components/auth/AuthForm.tsx`.

Una de las fuentes es `localStorage`, **que controla el cliente**. Hoy el daño es limitado
porque la RLS protege los datos, pero es la lógica que decide qué panel ve cada usuario, y
va a recibir dos tipos de cuenta más.

---

### H-07 · `ARCHITECTURE.md` está desactualizado y engaña — 🟠 Riesgo de despiste

El documento de la raíz, fechado en abril de 2026, afirma:

- que `availability_blocks` «no existe» → **existe**, y es una de las dos tablas de H-01;
- que hay «5 motores de precios» sueltos → **están consolidados** en
  `src/domain/pricingEngine.ts`, isomórfico y con tests.

**No se usa como mapa.** Merece reescribirse o archivarse, pero es trabajo aparte de este
proyecto: anotado aquí, no arreglado.

---

### H-08 · La auditoría de arquitectura se hizo sobre otra copia — 🟢 Verificado, sin consecuencias

El informe de arquitectura salió de `/Users/javier/Downloads/auditorias/fitosanitarios`
(worktree de `GarSer-referencia`), con **110 migraciones**. Esta carpeta tiene **113** y es la
misma línea, tres commits por delante.

Las tres de diferencia son `20260913120000` (H-04), `20260913121000` (H-03) y
`20260914121653` (imágenes de setos). **Dos de las tres afectan al plan** y ya están
incorporadas. Verificado que `assignee_id` y `provider_kind` no existen aquí, que es la
premisa del diseño.

Sirve de aviso: `docs/audit/HALLAZGOS-CONOCIDOS.md` documenta que en septiembre hubo
auditorías hechas sobre una línea distinta de `main` cuyas conclusiones no aplicaban.

---

### H-09 · `booking-authority` importa el motor de presupuesto — 🟠 Operativo, permanente

`supabase/functions/booking-authority/index.ts` importa desde `src/shared/`. Si se toca el
motor de precios o de presupuesto, **hay que redesplegar la función** o producción se queda
con la versión anterior. Ya ha causado divergencias antes.

Va en la sección de acciones manuales de toda entrega que toque el motor.

---

### H-10 · `npm run typecheck` no sirve como señal de regresión — 🟢 Informativo

**130 errores preexistentes** (2026-09-23), concentrados en `ServicesTab.tsx` (12),
`DetailsPage.tsx` (7) y `detailsPageDevSeeds.ts` (7). Eran 172 antes del merge #34, que dejó
`AuthForm.tsx` sin errores de tipos (tenía 34).
El build de Vite pasa porque no ejecuta `tsc`.

La señal de regresión de este proyecto es **`npm test`: 462 en verde / 68 ficheros**.

`AuthForm.tsx` se toca en F0 y **hoy tiene 0 errores de tipos**: la F0 debe dejarlo igual. Si
la F0 introduce uno solo en ese fichero, es regresión suya, no deuda heredada.

---

### H-11 · Cualquier usuario nuevo puede darse el rol de administrador — 🔴🔴 CRÍTICO · Resuelto en local (F0), pendiente en producción hasta la fusión

**Reproducido en local el 2026-09-23**, sobre una BD reconstruida con las mismas 113
migraciones que producción:

1. Registro de una cuenta nueva por la API (`/auth/v1/signup`), sin pasar por la web.
2. `POST /rest/v1/profiles` con `{"user_id": <el suyo>, "role": "admin"}` → **HTTP 201**.
3. En el acto, esa cuenta lee nombre, teléfono y rol de **todos** los perfiles.

La cuenta de prueba se borró al terminar.

**Por qué pasa:**

- La policy `Allow users to insert their own profile` solo comprueba `auth.uid() = user_id`,
  no el rol.
- El disparador `prevent_role_escalation` (migración `20260609200000`) es **`BEFORE UPDATE`**:
  protege el *cambio* de rol, no la *creación* del perfil.
- `profiles_role_check` admite `'admin'`.
- `is_admin()` es `EXISTS (… profiles WHERE user_id = auth.uid() AND role = 'admin')`, así
  que con eso basta para abrir todas las policies `admin_*` (migración
  `20260609184643_admin_full_access_rls.sql`).
- Solo funciona para quien **aún no tiene perfil** (`prevent_duplicate_profiles` bloquea el
  segundo). Y según H-12, un usuario nuevo **nunca** tiene perfil: es exactamente la ventana.

**Lo que se probó y NO funciona:** un usuario que ya tiene perfil no puede cambiarse el rol
por `PATCH` — el disparador lo rechaza con *«No tienes permisos para modificar el rol.»*

**Qué hay que hacer:**

- **En producción, fuera de GarSer Empresas** (decisión pendiente del usuario, D8): cerrar la
  creación de perfiles con rol privilegiado y revisar que no exista ya ningún admin ilegítimo.
- **En F0**, igualmente, como parte de «una sola fuente de verdad para el rol».

---

### H-12 · Nada crea el perfil de un usuario nuevo — 🟢 Resuelto en F0 (migración `20260923120000`)

**Evidencia.** En la BD local reconstruida, el único disparador sobre `auth.users` es
`trg_provision_admin` → `auto_provision_corporate_admin()`, que solo actúa si el correo es el
del administrador corporativo. Ninguna función de `public` inserta en `profiles` salvo esa;
no hay `handle_new_user` en ninguna migración; y **ni `src/` ni `supabase/functions/` hacen
`insert`/`upsert` sobre `profiles`**. Los perfiles de las cuentas de prueba salen de
`supabase/seed.sql`, no de ningún flujo de la aplicación.

**Por qué importa.** Explica los cinco «apaños» de H-06: como el usuario nuevo no tiene
perfil, la web adivina el rol desde `user_metadata` y `localStorage`. Y significa que **el
plan original de F0 («leer el rol solo de `profiles.role`») rompería a todos los usuarios
nuevos**, que no tienen fila.

**Confirmado en producción (2026-09-23)** por el usuario con la consulta 3 de
`01-PLAN-Y-PROGRESO.md` §5b: el único disparador sobre `auth.users` es `trg_provision_admin`.
No hay ninguno creado a mano. Producción y migraciones coinciden: nada crea el perfil.

**Consecuencia para F0:** antes de unificar la lectura del rol, **todo usuario tiene que
tener perfil, creado por el servidor** al registrarse, con un rol que solo puede ser
`client` o `gardener` (nunca `admin`), más un relleno para las cuentas que hoy no tienen.

---

### H-15 · El alta con el correo corporativo falla hoy, y el arreglo de H-12 la habría roto para todos — 🟢 Resuelto en F0

**Evidencia.** Registrar `mjgardenproject@gmail.com` en local devolvía HTTP 500 *«Database
error saving new user»*. En el log de Postgres: `supabase_auth_admin … relation "profiles"
does not exist`.

**Causa.** `prevent_duplicate_profiles()` (disparador `BEFORE INSERT` en `profiles`) consulta
`profiles` **sin esquema y sin `search_path` propio**. Durante el registro la sesión es la de
`supabase_auth_admin`, cuyo `search_path` es `auth`, así que no encuentra la tabla y aborta el
alta entera. `auto_provision_corporate_admin()` tampoco fijaba `search_path`.

**Por qué importa.** Hoy solo afectaba al correo corporativo, el único alta que creaba perfil
(en producción ya existe esa cuenta, por eso no se notó). Pero el disparador nuevo de F0 crea
perfil en **todos** los registros: sin este arreglo, **nadie habría podido registrarse**. Lo
detectó la verificación de F0 (prueba F0-14) antes de aplicar la migración.

**Arreglo.** La migración de F0 fija `search_path = public` en ambas funciones (§1b). No
cambia lo que hacen.

**Lección para el resto del proyecto:** toda función que dispare durante el registro corre
como `supabase_auth_admin`. Debe llevar `SET search_path = public` o nombres con esquema.

---

### H-13 · «Mi cuenta» actualiza el perfil por la columna equivocada — 🟠 Fuera de alcance

`MyAccount.tsx:66` (foto) y `:111` (cerrar cuenta) hacen `.update(…).eq('id', user.id)`. Pero
`profiles.id` **no** es el id del usuario: es otro uuid (la prueba de H-11 devolvió
`id ≠ user_id`). La clave es `user_id`. Así que esas dos acciones, muy probablemente,
**no actualizan ninguna fila y dicen «actualizado»**.

No es de este proyecto: anotado aquí, no arreglado. Si F0 toca `MyAccount.tsx` por el rol
(`:123`), se valora con el usuario.

---

### H-14 · Hay una pantalla de admin que escribe el rol desde el navegador — 🟢 Resuelto en F0

`RoleMonitor.tsx:104-105` (ruta `/role-monitor`) compara el rol del perfil con el de
`user_metadata` y lo «corrige» con `.update({ role })`. Hoy funciona porque el admin pasa el
disparador de escalada. Pero **su razón de ser es el desorden de H-06**: cuando F0 deje una
sola fuente de verdad, deja de tener sentido. Se decide en F0 si se retira o se reconvierte.

**Corrección a lo de arriba, al leerlo entero:** no compara con `user_metadata` sino con la
existencia de `gardener_profiles` (rol = `gardener` si y solo si está aprobado). Está en el
panel de admin (`/admin/users`), no solo en `/role-monitor`.

**Resolución (F0).** Con F0, esa regla se volvía **dañina**: todo jardinero *pendiente* tiene
ya perfil `gardener` sin `gardener_profiles`, así que el monitor lo marcaba y «Corregir» lo
degradaba a cliente, rompiendo su solicitud; y habría hecho lo mismo con empresas y
empleados. **Se reconvierte, no se retira:** solo detecta el caso real (aprobado con perfil
`client`) y solo corrige hacia arriba. Verificado en el navegador: jardinero pendiente no
marcado; aprobado puesto a `client` a mano → detectado y corregido.

---

### H-16 · La barra inferior del móvil nunca reconocía a un jardinero — 🟢 Resuelto en F0

`BottomNav.tsx` hacía `const { profile } = useAuth()`, pero `AuthContext` no expone `profile`:
siempre `undefined`, así que el jardinero veía «Inicio» en vez de «Panel». Era uno de los 130
errores de `tsc`. Con `useAccount()` queda resuelto (`tsc` 130 → 129) y probado en móvil.

---

### H-17 · No eran tres funciones las que escriben la agenda: eran cinco — 🟢 Resuelto en F1

El plan decía «actualizar `reserve_`, `release_` y `resize_booking_schedule`». La consulta a
las definiciones **vivas** de la BD (no a las migraciones) dio cinco escritoras de
`booking_blocks`: esas tres más **`create_atomic_booking`** (sin llamadas hoy: código muerto)
y **`confirm_booking_payment_attempt`**, que es la que crea la reserva cuando llega el pago
de Stripe (`booking-payment` y `booking-payment-webhook`): **el camino de todas las reservas
reales**. Con `assignee_id NOT NULL` y solo tres funciones adaptadas, la primera reserva
pagada tras la migración habría fallado.

Lección: el inventario de quién escribe una tabla se saca de `pg_get_functiondef` en la BD,
no de `grep` sobre migraciones.

---

### H-18 · `ON CONFLICT DO NOTHING` sin destino habría convertido el índice nuevo en una venta silenciosa — 🟢 Resuelto en F1

`create_atomic_booking`, `confirm_booking_payment_attempt` y `resize_booking_schedule`
insertaban los bloques con `ON CONFLICT DO NOTHING` **sin decir qué conflicto**. Postgres lo
aplica a **cualquier** restricción única. Con el índice nuevo `(assignee_id, date,
hour_block)`, un choque entre dos reservas no habría dado error: la segunda reserva se habría
creado **sin sus horas bloqueadas**, en silencio — peor que no tener índice. Lo que esas
funciones querían ignorar era el reintento de la misma reserva
(`booking_blocks_booking_id_date_hour_block_key`). Ahora dicen exactamente eso:
`ON CONFLICT (booking_id, date, hour_block) DO NOTHING`.

---

### H-19 · Hoy la agenda puede vender dos veces la misma hora si la disponibilidad se desincroniza — 🟢 Resuelto en F1

**Demostrado antes de la migración** (prueba F1-08 en rojo): marcando como libres en
`availability` las horas de una reserva confirmada (una desincronización), un **segundo
cliente** compró esas mismas dos horas del mismo jardinero. La agenda (`booking_blocks`) no
tenía ninguna defensa propia: dependía por completo de que la disponibilidad dijera la verdad.

Tras F1, el índice único lo impide por esquema: el pago del segundo cliente no se convierte en
reserva y queda en **`reconciliation_required`**, el estado que ya existía para pagos que no
pueden convertirse en reserva (migración `20260909122000_payment_reconciliation_helpers`).
El dinero no se pierde en silencio: queda marcado para conciliar.

---

### H-20 · Las solicitudes a varios jardineros están desactivadas para los clientes — 🟢 Informativo

`create_broadcast_booking_requests` tiene el `EXECUTE` retirado a `authenticated` (endurecimiento
de mayo) y ni la web ni las Edge Functions la llaman. Por eso hoy **nadie** alcanza la
comprobación de `reserve_booking_schedule`: el pago ya inserta los bloques y `reserve` sale sin
comprobar. La prueba F1-10 crea la reserva pendiente directamente en la BD para ejercitarla.
Relevante para F5: la asignación de empleados probablemente reutilice `reserve`.

---

### H-21 · Cualquiera podía darse de alta como jardinero sin aprobación, y un jardinero podía aprobarse el carnet — 🔴🔴 CRÍTICO · Resuelto en F2 (local), pendiente en producción hasta la fusión

**Reproducido en local el 2026-09-24**, con las mismas migraciones que producción:

- **(a)** La cuenta de **cliente** de prueba hizo `POST /rest/v1/gardener_profiles` con su propio
  `user_id` → **HTTP 201**. Salió en `public_gardener_directory` con **carnet fitosanitario
  «aprobado», 5,0 estrellas y 250 valoraciones inventadas**. Se puso precios y disponibilidad
  (HTTP 201) y `booking-authority` (`preview_providers`) **la ofreció como profesional
  reservable** junto al jardinero real. Es decir: anunciarse con un carnet que no se tiene y
  recibir reservas de tratamientos químicos, sin pasar por el admin.
- **(b)** El jardinero de la semilla, con el carnet puesto a **rechazado**, hizo `PATCH` de
  `has_phytosanitary_license` / `license_verification_status` / `license_expires_at` →
  **HTTP 204** y quedó `true / approved`. `bookingEligibilityCore.ts:173` da por válido ese carnet.

**Causa.** `authenticated` tenía `INSERT` y `DELETE` sobre `gardener_profiles` a nivel de tabla,
y la policy `Gardeners can manage own profile` (`FOR ALL`, `auth.uid() = user_id`) no mira
nada más. Las columnas de valoración sí estaban protegidas (migración
`20260823160000_rating_columns_readonly`), pero un `INSERT` rellena cualquier columna. Las de
carnet tenían privilegio de `UPDATE` por columna. `ProfileSettings.tsx:363` hacía un «insert si
no existe» desde el navegador (inalcanzable para un jardinero aprobado, pero abría la puerta).

**Por qué importa para Empresas.** Toda la premisa A-03 («un empleado no puede actuar como
proveedor porque no tiene ficha») era falsa mientras cualquiera pudiera crearse la ficha. Y D4
(carnet obligatorio y personal) no vale nada si uno se lo puede aprobar solo.

**Arreglo (migración `20260924120000`):** `REVOKE INSERT, DELETE` sobre `gardener_profiles` y
`REVOKE UPDATE` de las cuatro columnas de carnet a `anon`/`authenticated`. Las únicas escritoras
legítimas son funciones `SECURITY DEFINER` (aprobación de solicitudes y revisión de licencias),
que no se ven afectadas: comprobado que **aprobar a un jardinero sigue creando su ficha** (F2-18)
y que **el jardinero sigue pudiendo editar su ficha** (F2-09). `ProfileSettings.tsx` muestra un
error claro en vez de intentar crear la ficha. Pruebas F2-07 y F2-08: rojo antes, verde después.

**Producción.** Igual que H-11 (D8): `garser.es` no tiene usuarios reales, así que se arregla al
fusionar. **Si entran usuarios reales antes, hay que adelantarlo.** Y antes de fusionar conviene
comprobar que nadie lo ha aprovechado (consulta en `01-PLAN-Y-PROGRESO.md` §6).

---

### H-22 · Un jardinero podía crear su licencia fitosanitaria ya aprobada — 🔴 Resuelto en F3.1 (local), pendiente en producción hasta la fusión

**Reproducido en local el 2026-09-24:** el jardinero de la semilla hizo `POST
/rest/v1/gardener_licenses` con `status: 'approved'`, `expires_at: 2035-01-01` y `reviewed_at`
→ **HTTP 201**. La policy `Gardeners can insert own licenses` solo comprobaba
`auth.uid() = gardener_id`, no el estado.

**Alcance hoy:** el disparador `handle_new_gardener_license` deja la ficha del jardinero en
`pending`, así que el buscador (que mira la ficha) no se engañaba. Pero el panel de carnets del
admin mostraba una licencia «aprobada» que nadie revisó.

**Por qué importa para Empresas:** el carnet de un **empleado** (D4) no vive en una ficha de
proveedor: se comprueba directamente en `gardener_licenses`. Con este agujero, cualquier
empleado habría podido darse el carnet y hacer tratamientos químicos.

**Arreglo (migración `20260924130000`):** la subida solo admite `status = 'pending'` sin
revisión, y solo la pueden hacer proveedores o miembros activos de una empresa. Prueba F3-36.

### H-23 · Cualquiera podía preguntar si una persona concreta tiene carnet fitosanitario — 🟠 Resuelto en F3.3 (local)

En F3.1 se dio permiso de ejecución de `has_valid_phyto_license(user_id)` a todo usuario con
sesión. Con el id de cualquier persona devolvía si tiene carnet válido: un dato personal que
nadie fuera de su empresa y del admin necesita. Solo lo usan otras funciones del servidor.

**Arreglo (migración `20260924150000`):** se retira ese permiso; el dueño recibe el estado del
carnet de su equipo dentro de `company_team_overview()`. Prueba F3-39 (antes: 200; ahora: 403).
No afecta a producción: la función nació en esta rama.

### H-24 · Si el dueño trabaja, no tenía dónde subir su carnet — 🟢 Resuelto en F3.3

D4 dice que el carnet es de cada persona. El empleado lo sube en «Mi trabajo», pero la ficha
de la empresa (`/empresa/configuracion`) **no** lo pide (el carnet de una empresa no existe), así
que un dueño con «Yo también trabajo» veía fitosanitarios bloqueado y un texto que le mandaba
a «su panel», que no existe. Encontrado al probar en el navegador (F3-62).

**Arreglo:** si el dueño trabaja y la empresa ofrece fitosanitarios, «Tu empresa» muestra la
subida de su carnet, y el editor de servicios le dice dónde está.

### H-25 · El enlace de confirmación del correo perdía la invitación — 🟢 Resuelto en F3.3

Quien abre la invitación sin cuenta se registra, y el correo de confirmación le devuelve a la
**portada**, no a la invitación: el token se perdía y la persona quedaba como cliente sin saber
qué hacer. **Arreglo:** la página de la invitación la recuerda 24 h en el navegador
(`src/lib/pendingInvitation.ts`) y, al entrar, un cliente con una invitación pendiente va a ella.
Si se pierde (otro navegador), basta con volver a pulsar el enlace. Prueba F3-56.

### H-26 · Contar «cuántos hay libres» a cada hora no basta para vender trabajos de varias horas — 🟢 Resuelto en F4.1 (decisión del usuario, A-29)

El plan de F4 dice que `booking-authority` leerá una **capacidad** (`free_count`: cuántas personas
de la empresa están libres a cada hora) en vez de «libre / no libre». Al leer el código de venta
(2026-09-24) se ve que eso **vende huecos imposibles** en cuanto el trabajo dura más de una hora:

- Ana está libre de 9 a 10 y Luis de 10 a 11. Contando por horas hay 1 libre a las 9 y 1 a las 10,
  así que un trabajo de 2 horas a las 9 «cabe»… pero **nadie** puede hacerlo entero.
- Y al pagar no queda constancia de **quién** ocupa esas horas, así que dos clientes pueden llevarse
  a la misma persona si la cuenta se desincroniza (lo que H-19 cerró para autónomos).

Todo el camino del dinero (bloqueo mientras se paga, `prepare_booking_payment_attempt_for_client`;
confirmación, `confirm_booking_payment_attempt`; aceptar, `reserve_booking_schedule`; alargar,
`resize_booking_schedule`) funciona hoy con «una persona por proveedor», y el índice único de F1
(`booking_blocks`: persona + día + hora) ya está pensado para que la persona sea la unidad.

**Propuesta:** al vender, el servidor **elige a una persona concreta** del equipo que hace ese
servicio (y tiene carnet si hace falta) y está libre **todas** las horas del trabajo; el bloqueo
y la agenda se apuntan a esa persona. Para un autónomo, esa persona es él mismo: su camino no
cambia. El dueño podrá cambiar la persona en F5 (asignación). Las horas que ve el cliente son las
de «alguien del equipo puede hacerlo entero desde esa hora».

**Además, para poder vender hace falta que el equipo tenga horario.** Hoy un empleado no tiene
pantalla de disponibilidad (el plan la pone en F5). Sin ella, una empresa no tiene horas que
vender y el criterio de cierre de F4 (primera reserva a una empresa) es imposible.

### H-27 · Las pruebas de preparación de los servicios ya tenían 9 fallos antes de F4 — 🟠 Fuera de alcance

Al tocar `booking-authority` en F4 se pasaron las 7 baterías de `scripts/readiness/`. Fallan 9
pruebas, **las mismas y con los mismos números con el código anterior a F4** (se comprobó
poniendo las versiones de `HEAD` y repitiendo): césped 2, arbustos 2, palmeras 2, desbroce 1,
fitosanitarios 2. Son de tres tipos, ninguno de empresas:
- **Avisos de plausibilidad** (césped, arbustos, palmeras): el aviso sale con el texto pero la
  prueba espera un código (`lawn_area_implausible`…) o un umbral distinto.
- **Carnet del jardinero de la semilla** (fitosanitarios): la semilla lo marca aprobado sin
  licencia ni caducidad (ver consultas de F2), y la puerta de carnet lo excluye.
- **Horario de la semilla** (arbustos «cobertura», desbroce «sábado»): no hay horas libres en
  los días que la prueba elige.

### H-28 · Detalles de textos y datos para F5 — 🟢 El segundo punto resuelto en F5.4; el primero sigue anotado

Vistos al probar F4 en el navegador; ninguno impide vender:
- El resumen de la reserva dice **«Jardinero: Jardines Demo Costa»** y el botón del listado
  **«Confirmar jardinero»**: con una empresa sería mejor «Profesional». Es código común con los
  autónomos; se pule con D6 (F5), cuando el cliente vea también quién va.
- Un cliente puede leer los `booking_blocks` de su reserva, y con ellos el **id** de la persona
  asignada (no su nombre: no puede leer su perfil). D6 decide qué ve el cliente y cuándo; en F5
  hay que cerrar esa lectura o convertirla en «nombre y foto el día antes».

### H-29 · Los horarios podían reabrir horas vendidas, y al dueño que trabaja se le cerrarían las de todo su equipo — 🟢 Resuelto en F5.1

Al preparar los horarios del equipo (2026-09-24), leyendo el código que ya usa el autónomo:
- **La pantalla de horario guarda un día borrándolo y creando de nuevo las horas marcadas**
  (`availabilityServiceCompat.setGardenerAvailability`). Solo evitaba reabrir horas vendidas
  porque pinta como «Reservado» las reservas **en las que la persona es el proveedor**: un
  empleado no tiene ninguna (son de la empresa), así que habría podido marcar libres sus horas
  vendidas. La venta no se habría duplicado (lo impiden el índice de F1 y `provider_free_hours`),
  pero la agenda habría mentido.
- **El generador del horario fijo** (`generate_recurring_slots`, también el nocturno) vuelve a
  proteger lo reservado buscando reservas con `gardener_id` = esa persona. Para el dueño que
  trabaja, ese `gardener_id` es **su empresa** (A-19): se le habrían cerrado las horas de todos
  los trabajos de su equipo.

**Arreglo (migración `20260925130000`):** regla en la base de datos
(`protect_sold_availability`): una hora con `booking_blocks` de esa persona no se puede marcar
libre por ningún camino. El generador solo re-protege reservas antiguas sin agenda por persona.
`release_booking_schedule` saca las horas de la agenda antes de liberarlas. La pantalla pinta lo
ocupado con `my_busy_hours()` (la agenda de la persona) para empleados y dueños.

### H-30 · «Horario fijo» entraba en un bucle de pintado — 🟢 Resuelto en F5.3 (afecta también a autónomos)

Al abrir la pestaña «Horario fijo» la consola llenaba «Maximum update depth exceeded»
(`RecurringScheduleManager`). Causa, anterior a este proyecto: `AvailabilityManager` le pasaba
funciones creadas en cada pintado y el hijo las registraba en un `useEffect` que dependía de
ellas → nuevo estado en el padre → nuevo pintado. React lo corta, pero la pantalla trabaja de
más y puede ir a trompicones en móviles lentos. **Arreglo:** funciones estables (`useCallback`).
Al fusionar lo notarán también los autónomos (para bien).

### H-31 · El cliente veía a una empresa con el nombre personal de su dueño — 🟢 Resuelto en F5.4

Las pantallas del cliente (sus reservas, el inicio, el chat, las reseñas, las incidencias) sacaban
el nombre del profesional de su **perfil personal** (`fetchProfileNames`). En una empresa ese
perfil es el de la persona del dueño (A-19): el cliente leía «con Marta Dueña» en lugar de «con
Jardines Demo Costa» (o «Tu profesional» si el dueño no había puesto su nombre). Visto al probar
D6 en el navegador. **Arreglo:** `fetchProviderNames` toma el nombre de la ficha de profesional
(el mismo que ve el cliente en el listado al reservar) y, si no hay ficha, el del perfil; y la
tarjeta no recorta a «nombre de pila» el nombre de una empresa. Para un autónomo, pasa a verse el
nombre de su ficha (el del listado): normalmente es el mismo.

### H-35 · Reservar: un mes sin días reservables rompe la pantalla del profesional — 🟢 Resuelto (2026-09-25, anterior a Empresas)

Visto el 2026-09-25 en garser.es, justo tras la fusión, en el paso 4 del embudo (móvil, sin
sesión). El jardinero de producción pide 168 h de antelación, así que septiembre no tiene ningún
día reservable. `booking-authority` `month_days` contesta bien (`quote: null, days: []` y una
`exclusion`; la telemetría lo registra como `availability_calendar_loaded` con 0 días), pero
`ProvidersPage.rebuildMonth` (`src/pages/reserva/ProvidersPage.tsx:~308`) guarda ese `quote: null`
como presupuesto del profesional y lee `quote.availability` → excepción → el cliente ve «No se ha
podido cargar la disponibilidad» y la tarjeta pasa a «No disponible». Pulsando «→» (octubre) todo
funciona: 50,63 €, 3 h, horas desde el 05/10, resumen correcto hasta «Accede para continuar».
**Es anterior a Empresas:** el mismo código está en `6eef75c` (`ProvidersPage.tsx:299-300`) y el
servidor ya devolvía `quote: null` en ese caso. Le pasa a cualquier profesional cuando el mes que
se abre no tiene días reservables (antelación larga, fin de mes). **Arreglo propuesto** (pequeño,
fuera del alcance del proyecto; pendiente de que el usuario lo apruebe): con `quote: null`, no
tocar el presupuesto de la tarjeta, pintar el mes vacío sin error y, si el primer hueco está en
otro mes, abrir ese mes.

**Arreglo (aprobado por el usuario):** `rebuildMonth` y `loadValidHours` aceptan `quote: null`
(tipos de `fetchProviderMonthDays`/`fetchProviderValidHours` corregidos a `| null`): el mes o el
día se pintan vacíos sin error y la tarjeta conserva su presupuesto; si el mes se abrió por la
fecha elegida y el primer hueco del profesional cae después, se salta a ese mes (si el cliente
vuelve atrás a mano, se le deja allí). 2 pruebas nuevas en `ProvidersPage.test.tsx` (fallan sin
el arreglo). Rama `fix/h35-calendario-mes-vacio`.

### H-34 · En producción no hay ningún servicio activo: nadie es reservable — 🟢 Resuelto por el usuario (2026-09-25)

Visto el 2026-09-25, tras aplicar las migraciones y desplegar las funciones. La web de reservas
de producción (`booking-authority`, `preview_providers` de césped) contesta bien pero excluye a
todos con `inactive_service`: `gardener_service_prices` tiene 2 filas, de 1 jardinero, las dos
con `active = false`, sin cambios desde el 2026-07-08. **Es anterior a Empresas** (la regla de
`active` es de antes: `booking-authority/index.ts:298`). Las funciones nuevas sí funcionan con ese
jardinero: `provider_free_hours` devuelve sus 40 horas libres (= sus 40 horas disponibles) y
`plan_booking_cells` aparta 2 horas para un trabajo de 2 h. **Consecuencia:** las pruebas P- que
pagan (P-F1-1, P-F4-1, P-F8-1, P-F9-1) necesitan antes un profesional con un servicio activo
(activarlo desde su panel de precios, o dar de alta uno de prueba).

**Resolución:** el usuario activó «Corte de césped» (15 €/h, 150 m²/h). Comprobado contra
producción: 300 m² = 2 h / 30 € (gestión 3,75 €), elegible, primer hueco 06/10 a las 9:00. Antes
de esa fecha no sale nada porque ese jardinero pide **168 h de antelación**
(`recurring_availability_settings.min_notice_hours`, regla anterior a Empresas): no es un fallo.

### H-33 · «Solicitudes» no recibía los datos de F7 y F8 — 🟢 Resuelto en F9.4

Visto al probar F9 en el navegador. `BookingRequestsManager` no pasa a la tarjeta la reserva tal
cual: copia a mano una lista de campos. Los que añadieron F7 (`end_date`, `labour_hours`) y F8
(`booking_items`) no estaban en esa lista, así que en la pantalla de **solicitudes** no se veía el
rango de días ni las horas de trabajo de un trabajo de equipo, el nombre «A + B» de una reserva de
varios servicios salía como el primer servicio, y «Recalcular con las medidas reales» se ofrecía
también en reservas de varios servicios. En «Mis reservas» (otra pantalla) sí funcionaba, y ahí es
donde lo comprobé en su día. **Arreglo:** se copian esos campos (y `maintenance_plan_id`, F9).
Lección: en esta pantalla, un campo nuevo de la reserva hay que añadirlo también al mapeo.

### H-32 · La web recibía como mucho 1000 horas libres y cortaba el resto en silencio — 🟢 Resuelto en F7.2

PostgREST devuelve como mucho 1000 filas por petición (`max_rows`), **también** cuando se llama a
una función, y no avisa: comprobado en local con una función de 1500 filas (llegan 1000). Desde F4
la web (`booking-authority`) y el pago (`booking-payment`) leen las horas libres con
`provider_free_hours`, una fila por persona y hora: con varios proveedores en el listado, equipos
grandes o varios días (F7 pide 20 días más), se habrían perdido horas y el cliente vería menos
huecos o ninguno, sin error. Aún no estaba en producción (F4 va con la fusión). **Arreglo:** se
piden por páginas de 1000 (la función las devuelve ordenadas).

---

## 2. Decisiones de arquitectura cerradas

No se vuelven a discutir salvo que aparezca evidencia nueva. Si alguien propone lo contrario,
esta es la respuesta.

| # | Decisión | Razón |
|---|---|---|
| A-01 | **No se crea una tabla `providers`.** `gardener_profiles` ya lo es; se le añade `provider_kind`. | Crear la tabla obligaría a migrar cada clave ajena, RLS y RPC de 113 migraciones a cambio de cero funcionalidad. |
| A-02 | **No se renombra `bookings.gardener_id`.** Cambia su significado a *proveedor responsable*, documentado en `COMMENT ON COLUMN`. | Mismo motivo. El renombrado es coste puro. |
| A-03 | **El empleado no es proveedor.** No tiene fila en `gardener_profiles`. | Sin esa fila no puede tener precios ni aparecer en el directorio. Es una imposibilidad del modelo, no un `if` que se pueda olvidar. |
| A-04 | **No existe tabla de sesiones/jornadas.** Una jornada es `GROUP BY assignee_id, date`. | Almacenarla crea un segundo sitio donde la verdad se desincroniza. |
| A-05 | **La reseña es de la empresa**, con `performed_by` interno y fuera de la vista pública. | El cliente contrata a la empresa. Si el empleado se va, la reputación no se va con él. |
| A-06 | **La disponibilidad se declara siempre por persona.** La de la empresa se **deriva**, no se declara. | Es lo que impide tener dos sistemas de disponibilidad. |
| A-07 | **Empieza con vista, no con tabla materializada**, para la capacidad. | Una proyección materializada puede divergir de la realidad. Se materializa solo si se mide que hace falta. |
| A-08 | **Roles internos: solo `owner` y `employee`** al principio. El `CHECK` admite `manager` sin exponerlo. | Añadir un valor después es una migración de una línea. Construir hoy una matriz de permisos que nadie ha pedido, no. |
| A-09 | **El modelo económico no cambia.** Empresa cobra en mano, cliente paga la comisión por Stripe. | No hay Connect ni payouts. Salvo que D1 diga otra cosa. |
| A-10 | **`duration_hours` sigue con tope de 12 h.** Multi-día se expresa con bloques y `end_date`. | Ver H-02. Evita tocar siete guardas de dinero y agenda. |
| A-11 | **La solicitud de alta de empresa es una tabla propia** (`company_applications`), no una fila más de `gardener_applications`. Con su revisión en el panel de admin. | D2. La encuesta de empresa hace otras preguntas; `gardener_applications` está llena de columnas de jardinero individual (años de experiencia, preguntas de test de césped y setos) que en una empresa no tienen sentido. |
| A-12 | **Cada empleado tiene una lista de servicios** (`company_member_services`: empleado ↔ servicio). La capacidad de la empresa se calcula **por servicio**. | D5. Una empresa tiene hueco para el servicio X solo si hay libre alguien que hace X; con `required_workers = N`, hacen falta N personas libres que hagan X. Los servicios de un empleado tienen que estar activos en la empresa. |
| A-13 | **El carnet fitosanitario es por persona.** `gardener_licenses` pasa a poder colgar de un empleado. La bandera de la empresa se **deriva**: tiene capacidad fitosanitaria si al menos un empleado activo con ese servicio tiene carnet aprobado y en vigor. | D4. Evita que una empresa con licencia asigne a alguien sin carnet. Y el admin ya revisa carnets hoy: se reutiliza su pantalla, no se hace otra. |
| A-14 | **El dueño es un miembro más con un interruptor** (`counts_as_labour`). Si trabaja, tiene disponibilidad y servicios propios. | D3. No hace falta ningún caso especial en el cálculo de capacidad. |
| A-15 | **`assignee_id` lo rellena un disparador cuando nadie lo indica**, en vez de reescribir las cinco funciones que escriben la agenda. La asignación de empleados (F5) lo indicará explícitamente. **Desviación del plan, a sabiendas:** el plan decía que en F1 `reserve`/`resize` pasarían a «operar por ejecutante y aceptar varios días». Se ha dejado para cuando exista quien lo use (F5 asignación, F7 varios días): escribir hoy esa generalización sin ningún llamador que la ejercite sería código sin probar que luego habría que rehacer. | Mínimo radio de impacto sobre funciones de dinero. El índice único ya garantiza lo importante (no doble venta) para cualquier escritor, actual o futuro. |
| A-17 | **Nadie escribe directamente en las tablas de empresas, ni siquiera el admin.** Solo `SELECT` para `authenticated`; todas las escrituras irán por RPC `SECURITY DEFINER` (F3). | Si se concediera la escritura y solo la impidieran las policies, un `UPDATE` indebido no daría error: afectaría a 0 filas y respondería 200. Sin privilegio, la base de datos lo rechaza con 403 claro. |
| A-18 | **Visibilidad mínima dentro de la empresa:** cada miembro se ve a sí mismo y a sus servicios; el dueño ve a todo su equipo y sus invitaciones. Un empleado **no** lista la plantilla. | Matriz de permisos de la arquitectura. Los compañeros de un mismo trabajo se verán por una vía específica en F5. |
| A-19 | **La cuenta de la empresa es la del dueño.** `companies.provider_user_id` = su ficha `company`; el dueño es el miembro `owner` de esa misma cuenta. La base de datos lo impone. | Un solo inicio de sesión para el empresario. Si trabaja (D3), sus horas cuentan igual que las de un empleado. |
| A-20 | **`company` se puede declarar al registrarse**, como `gardener`: significa «se registró como empresa». Estar aprobada = tener fila en `companies`. **`employee` nunca se autodeclara**: solo lo asigna el servidor al aceptar una invitación. | Mismo significado que ya tiene `gardener` desde F0. Declararse `company` no da ningún permiso: todo lo de empresas depende de `company_members`, que solo crea la aprobación. |
| A-21 | **Cambio de rol de confianza:** las RPC del servidor que deben cambiar un rol (aceptar invitación, dar de baja a un empleado) activan una marca de la transacción (`garser.trusted_role_change`) que el disparador de escalada de F0 respeta. | El disparador bloquea cambios de rol hechos «por» el propio usuario, y dentro de una RPC `auth.uid()` sigue siendo el usuario. La marca solo se puede poner desde SQL: PostgREST no expone `set_config`. |
| A-22 | **Invitaciones:** token aleatorio de 32 bytes; en la BD solo su SHA-256; caduca en 7 días. Se devuelve **una vez** al dueño (para copiar el enlace) y va por email. Aceptar exige: sesión con el **mismo correo** invitado, cuenta de **cliente** (ni proveedor ni miembro de otra empresa). La empresa sale **del token**, nunca de un parámetro. | El token es un secreto enviado a un correo concreto; atarlo al correo impide usarlo si se filtra. |
| A-23 | **Las licencias dejan de exigir ficha de proveedor** (se quita la clave ajena a `gardener_profiles`; queda la de `auth.users`). Subir licencia: solo proveedores y miembros activos de una empresa. | D4 / A-13: el carnet es de la persona. Sin esto, un empleado no puede tener carnet. |
| A-25 | **`invitation_preview(token)` es pública** (también sin sesión): devuelve el nombre de la empresa, el correo invitado y el estado. | Quien abre el enlace aún no tiene cuenta y necesita saber quién le invita. Solo responde a quien tiene el token de 32 bytes; no revela nada que el enlace no dé ya. Un token inventado solo recibe «no válida». |
| A-26 | **La configuración de servicios, precios y zona de la empresa es la pantalla del autónomo** (`ProfileSettings`), en `/empresa/configuracion`; sin el carnet (es de personas, no de empresas). Adelantado de F4. | Un solo sistema de precios. Sin esto, el dueño no podía repartir servicios entre su equipo (D5 exige que la empresa los tenga activos). |
| A-27 | **Correo de invitación a prueba de abuso:** lo envía el servidor solo al correo guardado en la invitación, solo si lo pide su dueño con el token (comprobado contra la huella), **una vez por invitación** (`email_sent_at`) y con un **tope de 20 invitaciones al día por empresa**. La marca la hace `mark_company_invitation_emailed`, solo ejecutable con la clave de servicio. | El correo lleva la marca GarSer y el destinatario lo escribe la empresa: sin estos límites, una cuenta de empresa serviría para mandar correos masivos. |
| A-28 | **Correos de empresa aprobada / rechazada:** solo el admin; destinatario, nombre y motivo salen de `company_applications`, y solo se envían si la solicitud está en ese estado (si no, 409). | El correo no puede contradecir a la base de datos, ni llevar texto que no esté en ella. |
| A-29 | **Al vender a una empresa se aparta a UNA persona** del equipo que hace el servicio (con carnet si el trabajo lo exige) y está libre **todas** las horas; bloqueo de pago, agenda, alargar y cancelar operan sobre esa persona. **El dueño elige en su configuración** (`companies.assignment_mode`) si esa persona es definitiva (`auto`) o una propuesta que él confirma o cambia (`manual`, `bookings.assignment_pending`; la pantalla para cambiarla es de F5). Para un autónomo la persona es él mismo. **Desviación del plan, decidida por el usuario (2026-09-24):** el plan decía `free_count` por hora (H-26). | Nunca se vende un hueco que nadie puede hacer entero, y el índice único de F1 (persona + día + hora) protege a cada persona de la doble venta. |
| A-30 | **`provider_free_hours()` es la única fuente de «horas libres»** para la web (`booking-authority`) y el pago (`booking-payment`), que antes lo calculaban cada uno. Es función y no vista porque depende del servicio y del carnet (A-07 se mantiene: no se materializa). Solo la llama el servidor. | Una sola definición de «libre»; los horarios del equipo no se exponen a nadie. |
| A-31 | **La antelación mínima es de la empresa**, no de cada empleado: se guarda donde la de un autónomo (`recurring_availability_settings` de la cuenta de la empresa) y es la que aplica `booking-authority`. El empleado no la ve en su horario; el dueño la cambia en «Tu empresa». | Es una regla de venta del proveedor. Si cada empleado tuviera la suya, el cliente vería huecos distintos según a quién le tocara. |
| A-32 | **Una hora vendida a una persona no puede estar marcada libre** (`protect_sold_availability`, en la base de datos). | Una sola regla para todos los caminos que escriben horarios (pantalla, horario fijo, generador nocturno, futuros), en vez de confiar en que cada pantalla lo recuerde. |
| A-33 | **El empleado ve sus trabajos con una función (`my_jobs`), no leyendo la tabla `bookings`**; y el detalle de lo que hay que hacer y «he terminado» se abren a quien va (`is_booking_assignee`). **Desviación del plan, a sabiendas:** el plan decía extender `shares_booking_with()` con «estoy asignado». Eso habría abierto también perfiles y, vía las policies de `bookings`, precios, pagos y datos del presupuesto. | Mínimo privilegio: solo lo necesario para hacer el trabajo (dirección, hora, servicio, nombre y teléfono del cliente), solo de sus trabajos y solo mientras lo sean. |
| A-34 | **Cambiar quién va** (`assign_booking_worker`) lo decide solo el dueño y el servidor comprueba de nuevo servicio, carnet y que la persona esté libre **todas** las horas; mueve las horas de una agenda a otra en una sola operación. Elegir a la misma persona confirma la propuesta (modo «yo elijo»). | La lista de la pantalla es ayuda, no permiso (F5-10). |
| A-35 | **D6 lo sirve el servidor** (`booking_worker_for_client`): nombre y la inicial del apellido, y la foto; solo al cliente de esa reserva, confirmada, con una empresa, desde el día antes (hora de Madrid). La agenda por horas (`booking_blocks`) solo la lee el proveedor. | El cliente contrata a la empresa (A-05); saber quién llama a su puerta es útil el día antes, no para contactar al empleado por fuera. |
| A-36 | **Avisos al empleado** (`job_assigned`, `job_unassigned`): solo cuando el trabajo está **confirmado** (al aceptar la reserva, al confirmar la propuesta o al cambiar quién va), solo los pide el proveedor de esa reserva, el destinatario sale de la agenda (o, para «ya no vas», se comprueba que es del equipo y que ya no va) y a la propia cuenta no se le avisa. | Sin avisos por propuestas que aún pueden cambiar, y sin poder usarlo para escribir a quien sea. |
| A-37 | **Un trabajo puede tener una persona distinta por hora** (D10). El detalle vive donde ya estaba: `booking_blocks.assignee_id` por hora, y en el bloqueo de pago `booking_schedule_hold_blocks.gardener_id` por hora. Pago, confirmación, acortar y reasignar trabajan hora a hora; alargar lo hace quien hace la última hora. `assign_booking_worker` = «todas las horas a esta persona» sobre `assign_booking_hours`. | Sin tablas ni estados nuevos: el registro por persona y hora de F1 ya lo permitía. Para un autónomo o una sola persona, todo sigue igual. |
| A-38 | **Venta por turnos solo si la empresa lo acepta** (`companies.allow_split_jobs`, apagado por defecto). Encendido: una hora de inicio vale si cada hora del trabajo la puede hacer alguien; al pagar se reparte con los menos cambios de persona posibles. El camino de las solicitudes sin pago (`reserve_booking_schedule`) sigue con una persona. | D10. Apagado es lo de F4 (una persona entera). |
| A-39 | **Mover de fecha = propuesta al cliente** (D9): columnas propias en `bookings` (`reschedule_*`, sin escritura directa), 48 h para responder, rechazar no cambia nada (a diferencia del precio, no cancela). Al aceptar se comprueba otra vez quién puede hacerlo (prefiriendo a quien ya iba) y se mueve la agenda en una operación. Solo para empresas; no se bloquean horas mientras el cliente decide. | La fecha la eligió el cliente: no se le cambia sin su sí. No bloquear evita dejar el equipo ocupado por propuestas que quizá no se acepten; el precio es volver a comprobar al aceptar. |
| A-40 | **Un solo planificador** (`plan_booking_cells`, F7): devuelve quién hace cada hora de cada día. Orden: una persona → el equipo más pequeño hasta el límite de la empresa (todos desde la hora elegida, L repartida a partes iguales, jornada ≤ 12 h y hasta las 20:00) → por turnos si la empresa lo acepta y L ≤ 12 → si L > 12, días seguidos (se saltan los días sin nadie, hasta 21), el primero desde la hora elegida y los demás cada persona desde su primera hora libre, hasta N personas al día. Entre personas igual de válidas elige la de menos carga, lo que **no cambia** si se puede ni hasta qué día dura: la web (F7.2) repite la regla sin conocer la carga y una prueba comprueba que coinciden. Modelo: `duration_hours` = lo que dura el primer día (≤ 12, H-02 intacto), `end_date` = último día, `labour_hours` = L solo en trabajos de equipo o de varios días. | D11–D13. Nulos en los trabajos de siempre: nada de lo existente cambia de significado. |
| A-41 | **Trabajos de equipo o de varios días se reasignan cambiando a una persona por otra** (`replace_booking_worker`): sus horas pendientes pasan a otra que pueda hacer el servicio y esté libre en todas. No se alargan/acortan (el precio sí se puede cambiar, la duración no) ni se reparten por horas; mover de fecha vuelve a planificar con las mismas horas de trabajo (el precio no cambia). El fin del servicio en varios días es las 20:00 del último día. | Repartir hora a hora o alargar no tiene sentido cuando varias personas trabajan a la vez o hay varios días; cambiar a alguien que se pone enfermo sí. |
| A-42 | **Varios servicios = filas en `booking_items`**, que solo escribe el pago; `bookings.service_id` es el primero (lo que lee todo lo existente). Las reservas anteriores y las de caminos sin pago no tienen filas: `booking_service_ids()` cae en `bookings.service_id`, así que no hace falta rellenar datos viejos. El presupuesto guarda los servicios en `booking_quotes.items` (null = uno) y el pago comprueba que suman el total y las horas antes de apartar nada. | D14–D16. Ningún cambio de significado para lo que ya existe; un solo sitio (el pago) crea las filas. |
| A-43 | **Presupuesto de varios servicios = suma de presupuestos del motor de siempre** (`buildAuthoritativeMultiServiceQuote`): cada servicio con sus datos y su tarifa; el total es la suma de precios ya redondeados; gestión sobre el total. El embudo rellena un servicio cada vez (servicio activo) y guarda los datos de cada uno por separado; al servidor van en `items`. El nombre de lo reservado sale de una sola regla («A + B»). «Recalcular con las medidas reales» no se ofrece en reservas de varios servicios (usa el motor de uno). | Sin motor nuevo (Regla §3) y sin tocar el bloque de ningún servicio. Con un servicio, el camino de siempre byte a byte (sin `items`). |
| A-44 | **Plan de mantenimiento = propuestas que son presupuestos normales.** Cada visita nace como un `booking_quotes` con el precio fijo del plan (D19) y se paga por el camino de siempre (prepare/confirm, Stripe sin tarjeta guardada, D17). El pago no recalcula su precio: `maintenance_quote_is_intact` comprueba que coincide con el plan. Las propuestas las genera el reloj de cada 15 minutos (SQL), 7 días antes, porque los horarios solo existen unas semanas por delante. | Cero caminos nuevos de reserva o de pago (§3 de la guía). Observado de paso: las policies de cliente sobre `booking_quotes` (leer/insertar/actualizar las suyas) no tienen permisos de tabla detrás; son inertes. |
| A-24 | **La solicitud de empresa copia el patrón de la de jardinero:** el usuario crea su borrador y lo envía; aprobar o rechazar solo lo hace el admin por RPC, que es quien crea la ficha de proveedor, la empresa y el dueño. | Patrón existente y comprobado seguro (el usuario no puede pasar a `approved`). |
| A-16 | **`availability` es la única fuente que decide si una hora está libre.** `availability_blocks` pasa a ser un espejo que se escribe pero no decide. | H-01. La web, el pago y la confirmación ya usaban `availability`; `reserve` y `resize` se alinean con ellos. La retirada completa del espejo se hace en F4, junto a `provider_free_hours`. |

---

## 3. Sospechas sin verificar

Cosas que parecen problemas pero **no se han comprobado**. No se citan como hechos.

- **¿Hay solapes en `booking_blocks` en producción?** Si los hay, el índice único de F1 fallará
  al crearse. **Hay que consultarlo antes de migrar.** El MCP de Supabase conecta, pero al **local**:
  la consulta tiene que hacerse contra producción, desde su panel.
- **¿Está `availability_blocks` realmente poblada y coherente con `availability`?** Si se elige
  la opción A de H-01, da igual. Si se elige la B, hay que auditarlo antes.
- **¿Qué pasa con las reservas de difusión (`booking_requests`) cuando el que responde es una
  empresa?** El flujo debería funcionar sin cambios, pero no se ha leído
  `create_broadcast_booking_requests` con esa pregunta en mente.

---

- **¿Funciona «volver a intentarlo» de un jardinero rechazado?** `GardenerStatusPage.tsx`
  hace `update(status: 'draft')` sobre su solicitud **rechazada** y luego `delete`. Pero la
  policy `applications_own_update` solo deja actualizar filas en `draft`, y no hay policy de
  `DELETE`: ambas operaciones afectarían a 0 filas sin error. **No verificado** (fuera de
  este proyecto). La empresa no copia ese patrón: al corregir abre un borrador nuevo.
- **¿Sale el aviso «confirma tu correo» tras registrarse?** En local (donde el correo se confirma
  solo) el formulario se vació sin mostrar el aviso. No se ha comprobado en producción. Es
  código anterior a este proyecto (`AuthForm`); se mira en P-F3-6.
- **El registro desde una invitación dice «Rol seleccionado: Cliente · Este rol será permanente
  tras el registro»**, y en realidad pasará a empleado al aceptar. No es un fallo (se registra
  como cliente a propósito, A-22), pero confunde. Pulir al tocar `AuthForm`.
- **«Hace 1 hora» en una solicitud recién creada** (pantalla de solicitudes del profesional,
  visto en el hito). Parece un desfase de zona horaria en el cálculo relativo; afectaría también
  a autónomos. No verificado.
- **Una prueba escrita como «foto» y no como regla (F2-01)** falló al existir la primera
  empresa: decía «todas las fichas son `solo`». Se reescribió como la regla permanente
  («toda ficha sin empresa es `solo` y toda `company` tiene su empresa»). Lección para las
  próximas pruebas: comprobar invariantes, no el estado del momento.

## 4. Cómo añadir un hallazgo

```
### H-NN · Título en una línea — 🔴/🟠/🟢 Qué bloquea

**Qué pasa.** Con fichero:línea.
**Por qué importa.** El efecto real, de negocio o de riesgo.
**Decisión / recomendación.** Qué se hace. Si está pendiente, quién decide.
```

🔴 bloquea una fase · 🟠 hay que tenerlo en cuenta · 🟢 informativo o buena noticia
