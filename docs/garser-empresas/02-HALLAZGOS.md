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

### H-01 · Hay dos tablas de disponibilidad y el frontend solo usa una — 🔴 Bloquea F1

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

## 4. Cómo añadir un hallazgo

```
### H-NN · Título en una línea — 🔴/🟠/🟢 Qué bloquea

**Qué pasa.** Con fichero:línea.
**Por qué importa.** El efecto real, de negocio o de riesgo.
**Decisión / recomendación.** Qué se hace. Si está pendiente, quién decide.
```

🔴 bloquea una fase · 🟠 hay que tenerlo en cuenta · 🟢 informativo o buena noticia
