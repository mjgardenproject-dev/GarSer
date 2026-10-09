# Procedimiento para corregir los pendientes — GarSer

> **Para qué sirve.** Es el guion a seguir, al pie de la letra, cuando el usuario diga que se
> corrijan los pendientes de `05-HALLAZGOS-PENDIENTES.md` (PH-01…PH-13) y de
> `06-PRUEBA-REAL-PENDIENTE.md` (PR-01…PR-05). **Hasta entonces no se toca código.**
>
> Escrito el 2026-10-08 sobre `main` en `9c5306c` (tras las PR #41 a #45), que es lo que hay en
> producción. Este documento **no cambia las reglas** de `00-GUIA-DEL-CHAT.md`: las concreta para
> esta tanda y añade lo aprendido en la prueba real (§7).

---

## 1. Antes de empezar (cada sesión)

1. **Leer, en este orden:**
   - `00-GUIA-DEL-CHAT.md` (reglas).
   - `01-PLAN-Y-PROGRESO.md`, §5c y punto 2e.
   - `05-HALLAZGOS-PENDIENTES.md`.
   - `06-PRUEBA-REAL-PENDIENTE.md`.
   - Este documento, **en particular §8 (registro)**, para saber dónde se quedó.
2. **Trabajar sobre una copia idéntica a producción:**
   - `git fetch origin` y comprobar que `origin/main` es lo publicado (la última PR fusionada).
   - Rama nueva desde `origin/main`, por ejemplo `fix/pendientes-ph`. Nunca sobre `main` ni sobre
     ramas de otros trabajos.
   - `git status --short` vacío. **Si hay cambios que no son míos, parar y preguntar**: pasó el
     2026-10-08 con los formularios manuales.
3. **Línea base** (apuntarla en §8):

   | Medida | 2026-10-08 | Cómo |
   |---|---|---|
   | Pruebas unitarias | **921 en verde / 111 ficheros** | `npx vitest run` |
   | `tsc` | **128 errores** (anteriores al proyecto) | `npx tsc --noEmit -p tsconfig.app.json` |
   | Migraciones | **139** (la última, `20260929140000`) | `ls supabase/migrations` y, con permiso, en producción |
   | Baterías de empresas | **23 en verde (268 comprobaciones)** el 2026-09-29 | `scripts/garser-empresas/verify-*.mjs`, una a una |

   Si alguna no coincide, **entender por qué antes de seguir**. Por ejemplo, otra PR pudo cambiar
   el código.
4. **Entorno local en marcha:**
   - Supabase local desde **esta carpeta** (contenedores `supabase_*_GarSer-main_4`).
   - Funciones con `npx supabase functions serve` en segundo plano. Reiniciarlo si cambian los
     secretos de `supabase/functions/.env` o si se añade una función nueva.
   - Web con `preview_start` `empresas-dev` (puerto 5190).
   - Vault local con `lifecycle_tick_url` (hacia `http://supabase_kong_GarSer-main_4:8000/functions/v1/booking-lifecycle-tick`)
     y `lifecycle_tick_secret`. Sin ellos, la cola de avisos no se envía en local.
   - Si se ha rehecho la base local (`db reset`), volver a ponerlos.
   - Aplicar las migraciones nuevas con `psql`
     (`docker exec -i supabase_db_GarSer-main_4 psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 < fichero.sql`)
     hasta que PH-09 arregle `migration up`.
5. **Producción:** cada acceso se pide antes con una pregunta (leer, desplegar o migrar). Las
   consultas de lectura van con `npx supabase db query --linked`.

---

## 2. El ciclo de cada hallazgo (los 5 pasos)

Se hace **para cada PH o PR**, uno a uno, y **cada paso se apunta** en su ficha (§6) antes de
pasar al siguiente.

### Paso 1 — Leer el error

- Leer la ficha completa en `05` o `06` y su origen (el H- en `02-HALLAZGOS.md` y el R- en
  `04-FALLOS-PRUEBA-REAL.md`): qué se vio, la evidencia y la decisión del usuario.
- **Volver a localizar cada cita `fichero:línea`**, porque el código ha cambiado desde que se
  escribió (por ejemplo, con las PR #43 a #45). Si una línea ya no existe o dice otra cosa,
  apuntarlo.
- Apuntar la **decisión del usuario** que aplica. Si la ficha no tiene, es una decisión técnica y
  se dice cuál se toma (§5 de la guía).

### Paso 2 — Comprobar si el error es cierto

- **Reproducirlo antes de tocar nada**, de la forma más real posible:
  - Una batería o un script contra el Supabase local, con cuentas desechables del arnés
    `_company-harness.mjs`.
  - Y, si se ve en pantalla, en el navegador local.
- Si hace falta ver producción, consulta **de solo lectura** con permiso.
- Apuntar la evidencia: la orden o los pasos, y la salida.
- **Si no se reproduce:** no se corrige a ciegas. Se apunta «no se reproduce» con la evidencia y
  se pregunta al usuario si se cierra o si da más datos. Un fallo que solo pasó una vez puede
  depender de datos o de tiempos.
- Distinguir **fallo**, **mal diagnóstico** y **función nueva**, igual que en `04` §1b.

### Paso 3 — Comprobar que no pasa en situaciones parecidas

Antes de corregir se busca el **mismo patrón** en todo el sistema, no solo donde se vio:

- **El mismo código o la misma idea:** `grep` del patrón (por ejemplo `.eq('id', user.id)`) en
  `src/`, en `supabase/functions/` y en la base viva. Las funciones y reglas se sacan de
  `pg_get_functiondef` y `pg_policies` de la base local, **no** de grep sobre migraciones, que
  pueden estar sustituidas (lección de F1 y de `my_jobs`).
- **Todos los tipos de cuenta:** cliente, autónomo, dueño de empresa, empleado y admin.
- **Todos los caminos que llevan al mismo estado:** por ejemplo, una reserva se confirma porque
  acepta el proveedor, porque el cliente acepta una propuesta o porque se confirma una
  asignación.
- **Móvil (305–375 px) y escritorio**, y la app instalada.
- **Permisos análogos:** si una tabla deja escribir algo al navegador, mirar las tablas
  hermanas. Consulta útil: `information_schema.table_privileges` y `column_privileges` para
  `authenticated`, más `pg_policies`.
- Apuntar qué se revisó y qué se encontró.

### Paso 4 — Otros hallazgos encontrados por el camino

Todo lo nuevo que aparezca en los pasos 2, 3 o 5 se trata así:

| Si el hallazgo es… | Qué se hace |
|---|---|
| Claro, pequeño, del mismo tema y sin decisión de producto | Se corrige en la misma fase, con su prueba, y se dice en el resumen |
| Dudoso, o necesita decidir algo (textos, qué ve cada uno, qué se borra…) | **Pregunta al usuario** con la herramienta de preguntas (opciones claras y la recomendada primero), y mientras tanto se sigue con lo demás |
| Complejo o fuera del tema de la fase | **Nuevo PH en `05-HALLAZGOS-PENDIENTES.md`**, con evidencia, gravedad y propuesta; no se corrige ahora |
| De seguridad, dinero o datos personales | **Siempre se informa** en el resumen, aunque sea pequeño. Si es grave y está en producción, se dice el primero y se propone tratarlo antes que lo demás |

Se apunta en la ficha y en el índice de `05` (o de `04` si es de la prueba real).

### Paso 5 — Comprobar que está resuelto

1. **Pruebas unitarias** nuevas del caso, más `npx vitest run` completo: igual o más que la
   línea base y todas en verde.
2. **Batería del hallazgo** (`scripts/garser-empresas/verify-<tema>.mjs`):
   - Comprueba el caso, los casos parecidos del paso 3 y que **el autónomo no cambia**
     (Regla 2).
   - Después, **todas** las baterías: las 23 y las nuevas.
   - Si una batería antigua falla porque el comportamiento cambió a propósito, se reescribe su
     comprobación **sin rebajar lo que comprueba**, y se dice cuál y por qué. Pasó en F3 y F4.
3. **`npm run build`** sin errores y **`tsc` sin pasar de 128**.
4. **Navegador local**, con el flujo real que haría el usuario:
   - Dos usuarios a la vez: uno en `localhost:5190` y otro en `127.0.0.1:5190` (orígenes
     distintos, sesiones separadas).
   - Ancho de móvil (305 px en el panel) y comprobación de que nada se sale.
   - Consola sin errores nuevos (`read_console_messages`).
   - Captura de la prueba.
   - Lo que no se ve en pantalla (correos, cola, base de datos) se comprueba a la vez:
     `notification_outbox`, el registro del servidor de funciones (`MOCK EMAIL SEND`) y la
     consulta SQL.
5. **Pruebas reales a mi alcance:**
   - Flujos completos con cuentas desechables, pagos con el arnés (Stripe simulado en local) y
     correos en el registro.
   - Las notificaciones al móvil, hasta el servicio de push real (FCM responde por un
     dispositivo inventado).
   - Lo que solo se puede ver en garser.es se apunta como prueba P- en `03-PRUEBAS.md` §3 y en
     la guía de `06` §3.

---

## 3. Cierre de cada fase

Una fase se da por cerrada **solo** con todo esto (Regla 4, ampliada):

- [ ] Los 5 pasos apuntados en la ficha de cada hallazgo de la fase (§6).
- [ ] `vitest` en verde con el mismo número de pruebas o más, `build` sin errores, `tsc` en 128
      o menos, y todas las baterías en verde.
- [ ] Prueba en el navegador local hecha, con captura.
- [ ] `05`, `06` o `04` actualizados: estado «✅ Hecho (fecha)» en el índice y qué se hizo.
- [ ] `02-HALLAZGOS.md`: los cambios de diseño nuevos como A-NN, y los hallazgos nuevos.
- [ ] `03-PRUEBAS.md`: las pruebas nuevas (las locales con su resultado y las P- de producción
      por hacer).
- [ ] `01-PLAN-Y-PROGRESO.md` §5c al día y, si hay decisiones nuevas del usuario, la tabla de
      decisiones (D27…).
- [ ] §8 de este documento: una línea con fecha, fase, resultado y commit.
- [ ] **Commit en esa misma sesión** (Regla 5): solo los ficheros propios (`git add <rutas>`,
      nunca `-A`) y con la línea de coautoría.
- [ ] Comprobado que **no hay secretos** en lo que se commitea: buscar en el diff los valores de
      `supabase/functions/.env` sin mostrarlos, y que no entra ningún `.env`.
- [ ] La respuesta al usuario termina con **«Acciones manuales del usuario»**, aunque sea
      «(nada que desplegar)».

**Si la sesión se corta a mitad** (límite de uso): commit WIP con el estado y, en §8 y en la
ficha, **los pasos exactos que faltan**. Así se hizo en F5.

---

## 4. Fases de esta tanda (orden de `05` §3)

### Fase A — Bajas de cuenta: «Mi cuenta» y ficheros (PH-01, PH-04)

- **Decisiones:**
  - PH-01: baja real con comprobaciones, hecha por el propio usuario.
  - PH-04: borrar también sus ficheros.
- **Revisar:**
  - `MyAccount.tsx` (foto y «Cerrar cuenta»).
  - `private.account_closure_plan` y `perform_account_closure` (F6).
  - La función `admin-account-closure`.
  - `_shared/bookingMediaCleanup.ts`.
  - Los *buckets* de Storage y las rutas de cada fichero.
- **Situaciones parecidas (paso 3):**
  - Cualquier `.from('profiles')…eq('id', …)` en la web y en las funciones.
  - Toda escritura de perfil que diga «guardado» sin comprobar filas.
  - Las mismas acciones desde las pantallas de empresa y de empleado.
- **Pruebas:**
  - Batería `verify-self-closure.mjs`:
    - Sin reservas, se borra.
    - Con una reserva pendiente, bloqueado con su motivo.
    - Con historial, anonimizado, sin acceso y sin ficheros.
    - Nadie da de baja a otro.
    - El admin no se da de baja desde aquí.
  - La foto se guarda de verdad.
  - Navegador, con los tres casos desde «Mi cuenta».
- **Cuidado:**
  - Cerrar la sesión en todos los dispositivos al terminar.
  - Que un fallo al borrar un fichero no deshaga la baja; se reintenta.
  - Datos personales: confirmar en el paso 3 que no queda ninguna copia en otras tablas
    (solicitudes, ficha, reservas).

### Fase B — Jardinero rechazado que vuelve a solicitar (PH-02)

- **Decisión:** al momento, corrigiendo; el rechazo queda en un histórico.
- **Revisar:**
  - `GardenerStatusPage.tsx`.
  - Las reglas de `gardener_applications`. Tiene `UNIQUE (user_id)`, así que se reabre la misma
    fila.
  - `admin_review_gardener_application`.
  - `AuthContext.signIn`, que hace `upsert` del borrador.
  - El admin de solicitudes.
- **Situaciones parecidas:** el mismo «actualizar y borrar desde el navegador» en otras
  pantallas. Buscar `.update(` y `.delete()` sobre tablas con reglas restrictivas, y comprobar
  que se mira el número de filas devueltas.
- **Pruebas:**
  - Batería: rechazado → reabrir → enviar → el admin lo ve. Pendiente o aprobado no puede.
    Nadie toca la de otro.
  - Navegador de principio a fin, incluido el correo de alta o rechazo desde la cola.

### Fase C — Idempotencia y correo doble (PH-05, PH-08)

- **Decisiones:**
  - PH-05: cerrarlo.
  - PH-08 (técnica): a quien entra solo le llega «Nuevo trabajo».
- **Revisar:**
  - `booking_rpc_idempotency`: permisos, reglas y quién la escribe (`pg_get_functiondef`).
  - La rama `booking_reschedule_answered` de `send-email-notification`.
  - `private.sync_job_notices` (F4).
- **Situaciones parecidas:**
  - Otras tablas «técnicas» con escritura del navegador (`booking_batch_rpc_idempotency`…).
  - Otros pares de correos que se solapen en un mismo cambio, por ejemplo propuesta aceptada y
    trabajo asignado.
- **Pruebas:**
  - Batería: un usuario no puede insertar una marca; repetir una aceptación sigue siendo
    idempotente.
  - `verify-f6-reschedule` ajustada: quien entra recibe 1 correo.
  - Las 23 baterías, en verde.

### Fase D — Textos «Profesional» (PH-03)

- **Decisión:** «Profesional» para todos.
- **Revisar** todo el texto visible al **cliente** con «jardinero» referido al proveedor:
  - El embudo de reserva.
  - «Mis reservas».
  - Los correos al cliente.
  - El chat del cliente.
  - El perfil público.
- **No** se toca lo que ve el propio jardinero ni su alta.
- **Situaciones parecidas:** buscar también «Jardinero» y «tu jardinero» en las plantillas de
  correo (`send-email-notification`, `bookingEmailDetails`, `booking-confirmation-email`).
- **Pruebas:** unitarias de los textos y navegador, reservando con un autónomo y con una
  empresa. **Si se tocan los correos, redesplegar esas funciones.**

### Fase E — Aviso al proveedor suspendido (PR-02)

- **Decisión:** aviso en el panel y correo al suspender y al reactivar.
- **Revisar:**
  - `admin_set_provider_suspended`.
  - La cola de F3 (tipos nuevos `provider_suspended` y `provider_reactivated`).
  - `GardenerDashboard` y `/empresa`.
  - La lectura de la propia ficha (`suspended_at`).
- **Situaciones parecidas:** qué ve un empleado de una empresa suspendida. Sus trabajos ya
  citados siguen, pero ¿se le avisa? Si no está claro, **pregunta al usuario**.
- **Pruebas:** batería (1 aviso por suspensión y 1 por reactivación, sin duplicados), unitaria
  del aviso y navegador en los dos paneles.

### Fase F — Pruebas de servicios, entorno local y arquitectura (PH-07, PH-09, PH-06)

- PH-09 primero:
  - Registrar en `supabase_migrations.schema_migrations` local las versiones que faltan, sin
    volver a ejecutarlas.
  - Comprobar que `npx supabase migration up` funciona.
- PH-07:
  - Las 7 baterías de `scripts/readiness/`: ajustar cada prueba al contrato actual **sin rebajar
    lo que comprueba**.
  - Dar a la semilla carnet y horario.
  - **Ojo:** si al ponerlas al día aparece un fallo real de precios u horas, es un hallazgo nuevo
    (paso 4) y se trata como tal.
- PH-06: reescribir `ARCHITECTURE.md` a partir del código, con cada afirmación citando su
  fichero. Lo revisa el usuario.

### Fase G — Documentación (PH-10)

- Actualizar los estados de `02-HALLAZGOS.md` (H-02, H-03, H-06, H-11, H-17, H-21, H-22) y su §3
  «Sospechas».
- Cerrar el estado global en `01-PLAN-Y-PROGRESO.md` y añadir su fila de registro.
- Marcar PR-01 en `06` como resuelto: la PR #41 se fusionó el 2026-09-29.

### Fase H — Despliegue y pruebas en garser.es

1. **Permiso del usuario** con una sola pregunta que diga qué se va a hacer: lectura previa,
   secretos, funciones, migraciones y PR.
2. **Comprobación previa de solo lectura en producción.** Partir de la de F8 (`04` §3.4):
   - Restos y claves que fallarían.
   - Estados a medias.
   - Nombres reales de las reglas y claves.
   - Si algo sorprende, **parar y contarlo**.
3. **Copia de seguridad antes de migrar** (no se hizo en F8; se añade):
   - `npx supabase db dump --linked` (esquema) y, si el usuario lo permite, también los datos.
   - Guardarla en `~/Downloads/garser-backups/<fecha>/`, fuera del repositorio, porque contiene
     datos personales.
4. **Orden de despliegue.** Lección de F8: la `booking-authority` nueva filtraba por una columna
   que aún no existía, y el catálogo se quedó sin proveedores hasta migrar.
   - Primero las migraciones que **añaden** (columnas, tablas, funciones).
   - Después, las funciones que las usan.
   - Las funciones que deben convivir con la web antigua, antes de lo que las sustituye.
   - **Si una función depende de algo que crea la migración, la migración va primero.**
5. Secretos, si hay alguno nuevo: desde un fichero temporal en la carpeta de borradores, con
   `supabase secrets set --env-file`, y borrarlo después. **Nunca** con el valor en el comando.
6. Funciones con `--use-api`. Si se toca el motor de precios, **redesplegar `booking-authority`**
   (H-09).
7. Comprobación después:
   - Estructura, permisos (nada interno ejecutable por `anon` ni `authenticated`) y relojes.
   - Una llamada real a cada función tocada.
   - **El catálogo sigue ofreciendo horas**: `valid_hours` con las coordenadas del cliente.
8. **PR de la web: la fusiona el usuario** (`gh pr merge` está bloqueado y no se intenta).
9. **Guía de pruebas en garser.es** (`06` §3, sesiones 1 a 7):
   - Las hacemos juntos. Cada inicio de sesión se pide con una pregunta («ahora necesito que
     inicies sesión como …» y la opción «Ya lo he hecho»).
   - En cada paso compruebo la base de datos (solo lectura) y la cola de avisos.
   - El usuario teclea él mismo las tarjetas de prueba de Stripe y las contraseñas reales.
10. **Limpieza final de los datos de prueba de producción**, con la herramienta de bajas de F6,
    y comprobación de que no queda nada.
11. **Recordar al usuario** lo que solo puede hacer él:
    - Stripe en claves reales antes de tener clientes.
    - Revisar los correos en la bandeja real (también el *spam*).

---

## 5. Cosas importantes que no hay que olvidar

- **Anotar el progreso siempre**, en la ficha, en el índice y en §8. El estado real es el de los
  documentos, no el de la memoria del chat.
- **Regla 2: el autónomo no se rompe.** Cada batería nueva incluye un caso de autónomo.
- **Mobile-first:** toda pantalla nueva o tocada se mira a 305–375 px, sin scroll lateral, con
  áreas de toque de 44 px y nombres accesibles en los botones de solo icono.
- **Accesibilidad básica:** `aria-label` en los iconos, `aria-pressed` y `aria-busy` donde
  toque, y textos que no dependan solo del color.
- **Seguridad en cada fase:**
  - Nada que escriba el navegador sin regla estricta.
  - Funciones internas solo para `service_role`.
  - Revisar `anon` y `authenticated` tras cada migración.
  - Ningún `company_id` aceptado del cliente (§3 de la guía).
- **Datos personales:** lo que se borre de verdad, también en los ficheros (PH-04). No poner
  datos personales en URL ni en registros.
- **Dinero:** cualquier cambio que toque reservas o pagos se prueba con la batería de pagos y
  comprobando importes antes y después.
- **Correos y móvil:** todo aviso nuevo se apunta en la cola (`notification_outbox`), no desde el
  navegador, y sale también al móvil sin tocar nada más. Su texto se revisa como lo leerá el
  usuario.
- **Zonas horarias:** fechas y horas como las verá el usuario en España. Lección de «Hace 1
  hora».
- **Plan de vuelta atrás** en cada migración: apuntar en la ficha cómo deshacerla si falla en
  producción, por ejemplo restaurar la regla o la función anterior.
- **Memoria del chat:** al cerrar la tanda, actualizar la memoria `garser-empresas` con el estado
  y las lecciones nuevas.
- **No compactar a ciegas:** antes de una sesión larga, que todo esté commiteado y §8 al día.

---

## 6. Ficha de seguimiento (copiar en cada PH o PR al trabajarlo)

```markdown
#### Seguimiento (AAAA-MM-DD)
1. Leído: fuente, citas revisadas (¿siguen en esas líneas?), decisión que aplica.
2. ¿Es cierto?: cómo se reprodujo y salida, o «no se reproduce» y qué se preguntó.
3. Casos parecidos: qué se buscó (patrón, tipos de cuenta, caminos, móvil, permisos) y qué salió.
4. Hallazgos nuevos: cuáles; corregido / preguntado (respuesta) / apuntado como PH-NN.
5. Comprobado: pruebas unitarias, batería (n/n), todas las baterías, navegador (captura) y
   pruebas reales; pendiente en garser.es (P-…).
Commit: <hash>. Vuelta atrás: <cómo>.
```

---

## 7. Trampas ya conocidas (lecciones de esta tanda)

| Trampa | Qué hacer |
|---|---|
| Un *trigger* `AFTER UPDATE OF columna` no ve los cambios que hace un `BEFORE` | Usar `AFTER UPDATE` con `WHEN (OLD … IS DISTINCT FROM NEW …)` (F3) |
| Un *trigger* que compara el estado debe ver el **final** de la transacción | `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` (F4) |
| En las pruebas, cada `sql()` del arnés es **su propia transacción** | Lo que en la web va junto (liberar y cancelar), hacerlo en una sola llamada (F4, EV-06) |
| Columnas `NOT NULL` al anonimizar (`gardener_profiles.phone`…) | Cadena vacía en vez de `NULL`; mirar `is_nullable` antes (F6) |
| `pg_net` solo envía tras el commit | Bien para el timbre; no esperar respuesta dentro de la transacción |
| `RESTRICT` en reservas y miembros | El arnés y cualquier borrado tienen que quitar primero las reservas (ya lo hace `cleanupUsers`) |
| Clics en ráfaga en el navegador usan el mismo estado de React | Una acción, una pausa (F5) |
| En el panel del navegador las pestañas de fondo siguen «visibles» | Lanzar `visibilitychange` a mano para probar «al volver a la app» (F2) |
| El navegador del panel trae las notificaciones **bloqueadas** | La entrega real al móvil se prueba en garser.es (P-R08-1) |
| GoTrue local responde 400 donde producción da 403 | Aceptar los dos códigos en las baterías (F1) |
| `booking-authority` sin las coordenadas del cliente da `missing_coordinates` | Mandar siempre `addressCoordinates` al probar el catálogo (F8) |
| `supabase migration up` local se niega (historial) | `psql` hasta que se arregle PH-09 |
| En macOS no existe `timeout` | Bucle `until …; do sleep 5; done` o tareas en segundo plano |
| PostgREST corta en 1000 filas, también las RPC | Paginar (H-32) |
| `functions deploy` se cuelga | `--use-api` |
| `gh pr merge` está bloqueado | La PR la fusiona el usuario |
| Tras un `db reset` (lo hizo otra sesión antes del 2026-10-09) el Vault local queda vacío | Volver a poner `lifecycle_tick_url` y `lifecycle_tick_secret` (sin mostrar el secreto) antes de las baterías |
| Si el Mac duerme (tapa cerrada), el reloj de Docker se queda atrás: «JWT issued at future» y `docker logs --since` vacío | Repetir la batería con el Mac despierto; en baterías nuevas, buscar en el registro por un dato único en vez de por hora |
| `booking-photos` es público en producción y privado en local | No dar por buena una prueba de imágenes del chat solo en local (PH-16) |
| `renderBrandedEmail` ya escapa encabezado, texto y botón | No volver a llamar a `escapeHtml` en las plantillas (A-49) |

---

## 8. Registro de esta tanda

| Fecha | Fase | Qué | Resultado | Commit |
|---|---|---|---|---|
| 2026-10-08 | — | Procedimiento escrito sobre `main` `9c5306c`; línea base 921/111, `tsc` 128, 139 migraciones | Sin cambios de código | `77a175e` |
| 2026-10-09 | — | Arranque: rama `fix/pendientes-ph` sobre `77a175e` (= `origin/main` `9c5306c` + docs). Línea base confirmada: 921/111, `tsc` 128, 139 migraciones; **23 baterías / 268 comprobaciones** en verde. Vault local vacío tras un `db reset` ajeno: repuesto | — | — |
| 2026-10-09 | A | PH-01, PH-04, PH-14 y PH-15 corregidos; PH-16 y PH-17 apuntados. Vitest 930/113, build ✅, `tsc` 128, 24 baterías, 280/280 (`verify-self-closure` nueva, 12/12; 4 repetidas porque el Mac se durmió: «JWT issued at future»), navegador local con los tres casos | ✅ Fase A cerrada | `3e40929` + `d0dc28a` |
| 2026-10-09 | B | PH-02 corregido (histórico de rechazos, reabrir por RPC, campos de revisión protegidos); PH-18 apuntado. Vitest 937/115, build ✅, `tsc` 128, 25 baterías 288/288 (`verify-gardener-reapply` nueva, 8/8), navegador local con jardinero y admin | ✅ Fase B cerrada | `4ef9d4c` + (este commit) |
