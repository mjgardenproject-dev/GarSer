# Fallos de la prueba real en garser.es — GarSer Empresas

> Abierto el 2026-09-28, tras fusionar la PR #40. El usuario usa garser.es como un usuario real y
> reporta los fallos **uno a uno**. Por cada fallo, el chat:
>
> 1. Investiga la causa exacta, con `fichero:línea` y comprobándola contra producción cuando se
>    pueda.
> 2. Lo apunta aquí.
> 3. **No toca código.** El código se cambia solo cuando el usuario termine de reportar.
>
> Cuando el usuario cierre la lista, se escribe en §3 el **plan de implementación por fases**,
> con sus pruebas (locales y en garser.es), y solo entonces se programa.
>
> Numeración: **R-NN** (fallo de la prueba Real), para no mezclarla con los H-NN de
> `02-HALLAZGOS.md`. Si un R cambia una decisión de diseño, se enlaza desde allí.

---

## 1. Índice

| # | Qué ve el usuario | Gravedad | ¿Es de GarSer? | Estado |
|---|---|---|---|---|
| R-01 | Al iniciar sesión como admin, la consola se llena de errores | Baja (sin efecto funcional) | Una parte sí (1 aviso); el resto es de una extensión de Chrome | Analizado |
| R-02 | Supabase no deja borrar al usuario dueño de una empresa («Database error deleting user»); y borrar otras cuentas deja restos | Media (no se puede dar de baja; restos que confunden al admin) | Sí | Analizado · **decisión pendiente** · el usuario pide un sistema seguro para borrar o suspender empresas |
| R-03 | No hay forma de recargar para ver el estado nuevo de las reservas (jardinero y cliente) | Media (en la app instalada no hay botón de recargar) | Sí | Analizado |
| R-04 | Cuando un jardinero acepta la invitación, la empresa no se entera ni sabe que tiene que configurarlo | Media (el empleado nunca recibe trabajos y nadie lo avisa) | Sí (falta) | Analizado |
| R-05 | El trabajador no recibe ningún aviso cuando la empresa le cambia el horario | Media | Sí (falta) | Analizado |
| R-06 | Al enviar una propuesta de precio y duración se cerró la sesión de la empresa; además la solicitud decía «Hace 1 hora» a los pocos minutos | **Alta** (sesiones que se cierran solas y correos que no salen) | Sí | Analizado · causa confirmada en producción |
| R-07 | El empleado ve el trabajo «Por confirmar» antes de que el dueño lo acepte; y no siempre le llega un correo cuando ya es suyo | Media | Sí | Analizado |
| R-08 | Todo lo que llega por correo tiene que llegar también como notificación al móvil, a todos los usuarios | Nueva función | — | Analizado · **decisión pendiente** |

Gravedad: **Crítica** (dinero, datos o seguridad) · **Alta** (un usuario no puede completar algo)
· **Media** (lo completa, pero mal o confuso) · **Baja** (cosmético, o solo se ve en la consola).

### 1b. Clasificación (2026-09-28, antes del plan)

Qué es cada cosa reportada: **fallo** (la web hace algo mal), **mal diagnóstico** (lo que se vio
no es un fallo de GarSer, o no es lo que parecía) o **función nueva** (algo que falta y se pide).

| # | Lo reportado | Clasificación | Lo que sí hay que corregir |
|---|---|---|---|
| R-01a | 92 errores de consola al entrar como admin | **Mal diagnóstico**: son de una extensión de Chrome | Nada |
| R-01b | Aviso del WebSocket al entrar como admin | Fallo menor (solo consola, sin efecto) | El contador de chats abre y cierra una conexión en el panel de admin |
| R-02 | Supabase no deja borrar al dueño de la empresa | **Mal diagnóstico**: el freno es a propósito, para no borrar una empresa con su histórico | **Hallazgos reales** que salieron al investigar: restos de cuentas borradas (solicitud huérfana en el admin); borrar un cliente o autónomo desde Supabase se lleva sus reservas pagadas; y **función nueva** pedida: borrar o suspender empresas de forma segura |
| R-03 | Botón de recargar | Función nueva (en la app instalada no hay forma de recargar) | Botón «Actualizar» y refresco al volver a la app |
| R-04 | Aviso «X ha aceptado… configúralo» | Función nueva | Aviso hasta tener horario fijo y un servicio, y correo al dueño |
| R-05 | Correo «tienes un nuevo horario» | Función nueva | Un correo por cada «Guardar» |
| R-06 | «Al enviar la propuesta me cerró la sesión» | **Mal diagnóstico en parte**: no lo provocó la propuesta, sino un cierre de sesión de la empresa 14 min antes en otro sitio | **Fallos reales**: cerrar sesión cierra todos los dispositivos sin avisar; el correo de la propuesta no salió (los correos dependen del navegador); «Hace 1 hora» a los pocos minutos |
| R-07 | El empleado ve trabajos sin aceptar | **Fallo** | Solo ver trabajos confirmados y con su persona decidida; el correo al empleado no sale cuando se confirma por una propuesta de precio |
| R-08 | Notificaciones al móvil | Función nueva (decisión pendiente) | Push web o app nativa |

---

## 2. Fallos

### R-01 — Errores en la consola al iniciar sesión como admin

**Qué se ve.** Tras iniciar sesión con la cuenta de admin en garser.es, la consola del navegador
muestra, por orden:

- `Error in event handler: TypeError: Cannot read properties of undefined (reading 'id')`, en
  `chrome-extension://pejdijmoenmkgeppbflobdenhhabjlaj/background.js`.
- 86 veces `Unchecked runtime.lastError: The message port closed before a response was received.`
- 5 veces `Uncaught (in promise) FrameDoesNotExistError: Frame N does not exist in tab …`, en
  `background.js`.
- 1 vez `WebSocket connection to 'wss://hleqspdnjfswrmozjkai.supabase.co/realtime/v1/websocket…'
  failed: WebSocket is closed before the connection is established.`, en `index-B4afYII6.js`
  (el código de garser.es).

Son **dos problemas distintos**.

#### R-01a — Los 92 primeros mensajes no son de GarSer

Los tres primeros tipos de mensaje los genera una **extensión de Chrome** instalada en el
navegador del usuario:

- Todos salen de `chrome-extension://pejdijmoenmkgeppbflobdenhhabjlaj/background.js`, el script
  de fondo de esa extensión. Ninguno sale de `garser.es`.
- `runtime.lastError` y `FrameDoesNotExistError` son errores de la API de extensiones de Chrome.
  Pasan cuando la extensión envía mensajes a pestañas o marcos que ya se han cerrado o han
  cambiado de página, como ocurre al iniciar sesión y redirigir.
- GarSer no usa `chrome.runtime` ni mensajería entre marcos.

**Qué hacer:** nada en GarSer. Para saber qué extensión es:

1. Abrir `chrome://extensions`.
2. Activar el «Modo de desarrollador».
3. Buscar el identificador `pejdijmoenmkgeppbflobdenhhabjlaj`.

Para probar garser.es sin ese ruido, usar una ventana de incógnito sin extensiones. Un cliente
real con esa misma extensión vería lo mismo en su consola, pero la web le funciona igual.

#### R-01b — El aviso del WebSocket sí es de GarSer

**Qué es.** El distintivo de «mensajes sin leer» de la barra de navegación abre una conexión en
tiempo real y la cierra antes de que termine de conectarse. El navegador avisa de ese corte.

**Causa exacta.** Se ha comprobado contra el código publicado: la línea 420 de
`https://garser.es/assets/index-B4afYII6.js` contiene `useUnreadChats` (el canal
`unread_badge_…`) y el envío del formulario de acceso (`navigate(… "/dashboard")`), que son las
funciones del rastro.

1. El admin inicia sesión en `/auth`. En esa página no se pintan ni la barra superior ni la
   inferior: `src/App.tsx:113` (`isAuthPage`), `:267` y `:598`.
2. `AuthForm` llama a `signIn` y después navega **siempre** a `/dashboard`
   (`src/components/auth/AuthForm.tsx:136-138`).
3. `/dashboard` no es una página de admin, así que se montan `Navbar` y `BottomNav`
   (`src/App.tsx:267`, `:598`). Cada una usa `useUnreadChats`, que, al haber usuario, abre un
   canal de Realtime (`src/hooks/useUnreadChats.ts:42-54`). Esa es la primera conexión del
   WebSocket, que empieza a conectarse.
4. En ese mismo instante, `/dashboard` ve que la cuenta es admin y redirige a `/admin/dashboard`
   (`src/App.tsx:336-337`).
5. En `/admin/*` no se pintan las barras (`src/App.tsx:117`, `isAdminPage`), así que se
   desmontan. La limpieza del hook llama a `supabase.removeChannel`
   (`src/hooks/useUnreadChats.ts:59`).
6. `removeChannel` de realtime-js 2.15.5 desconecta el WebSocket cuando no queda ningún canal
   (`node_modules/@supabase/realtime-js/dist/main/RealtimeClient.js:240-245`). El socket aún
   estaba conectándose, y el navegador escribe el aviso.

**Impacto.**

- **Ninguno funcional.** El panel de admin no usa tiempo real, y no hay datos en juego.
- Es una **conexión desperdiciada**: se abre y se cierra sin usarse en cada inicio de sesión de
  admin.
- Es **ruido en la consola**, que tapa los errores de verdad cuando se prueba.
- **Otras cuentas.**
  - Cliente, autónomo, dueño de empresa y empleado **no** lo tienen al iniciar sesión: tras
    `/dashboard` siguen en páginas con barras, así que el canal se queda abierto y se usa.
  - Aun así, el paso por `/dashboard` y la redirección son comunes a todas las cuentas, y
    cualquier salto a una página sin barras justo después de montarlas repite el aviso. Por
    ejemplo, entrar en una reserva nada más iniciar sesión, porque en `/reserva*` también se
    ocultan (`src/App.tsx:114`, `isBookingPage`).
- Se relaciona con dos cosas conocidas, que no se tocan aquí:
  - `AuthContext` escribe mensajes `console.log('🕒', …)` en producción
    (`src/contexts/AuthContext.tsx:106`).
  - Cada cuenta monta **dos** canales iguales, uno por barra (`useUnreadChats.ts:18-19`).

**Solución propuesta** (a confirmar en el plan de §3):

1. **Que el admin no pase por `/dashboard`.** Al iniciar sesión, llevar a cada cuenta
   directamente a su panel (`/admin/dashboard` para el admin). El tipo de cuenta ya se lee en
   `signIn` (`AuthContext.tsx:176`), así que se evita montar las barras para desmontarlas un
   instante después.
2. **Que el distintivo de chats no se active en una cuenta de admin.** El admin no tiene chats,
   y así no se abre el canal aunque en el futuro se llegue a otra página con barras.
3. **Un único canal de «sin leer» por usuario,** compartido por `Navbar` y `BottomNav` (un
   proveedor o un contador de uso), en lugar de uno por barra. Si una barra se desmonta, la otra
   no pierde la conexión.
4. **Opcional, a decidir:** quitar en producción los `console.log` de diagnóstico de
   `AuthContext`, para que la consola solo muestre lo que importa.

**Pruebas propuestas.**

- **Unitarias:**
  - `useUnreadChats` no abre canal para una cuenta de admin.
  - Con `Navbar` y `BottomNav` montadas a la vez se abre **un** canal.
  - Al desmontar una barra, el canal sigue abierto; al desmontar las dos, se cierra.
  - El destino tras iniciar sesión depende del tipo de cuenta: admin → `/admin/dashboard`.
- **Navegador local:**
  - Iniciar sesión como admin con la consola abierta: ningún aviso de WebSocket, y en la
    pestaña «Red» ninguna conexión `realtime` abierta.
  - Iniciar sesión como cliente: una sola conexión, que se queda abierta.
  - El distintivo de «sin leer» sigue subiendo al recibir un mensaje.
- **En garser.es (P-R01-1):** iniciar sesión como admin en una ventana de incógnito sin
  extensiones y comprobar que la consola queda limpia. Repetir como dueño de empresa y como
  cliente, y comprobar que el chat avisa en tiempo real.

### R-02 — No se puede borrar en Supabase al usuario dueño de una empresa

**Qué se ve.** En el panel de Supabase (Authentication → Users), al borrar el usuario
`jrodgom1204@gmail.com` (`289c6a0f-…`), sale «Failed to delete selected users: Database error
deleting user». La consola del panel muestra un `DELETE …/platform/auth/…` con error 500. Los
avisos de `ConfigCat` que aparecen en la consola son del propio panel de Supabase, no de GarSer.

**Quién es ese usuario** (consulta de solo lectura en producción, 2026-09-28):

- Es la cuenta de la empresa «Jardines sa» (`companies.id 5b013f6f-…`, activa), la **única
  empresa de producción**.
- Tiene `profiles.role = 'company'`, una ficha en `gardener_profiles`, su solicitud de empresa
  aprobada y su fila de dueño en `company_members`.
- Hay además un empleado inactivo, 4 invitaciones y 1 presupuesto. No tiene reservas.

**Causa exacta.** Se ha comprobado en producción con un borrado de prueba dentro de un bloque que
siempre se deshace. El usuario sigue existiendo.

1. Supabase borra la fila de `auth.users`. Por `ON DELETE CASCADE` intenta borrar su
   `gardener_profiles`.
2. `companies.provider_user_id` apunta a esa ficha con **`ON DELETE RESTRICT`**
   (`supabase/migrations/20260924120000_empresas_f2_provider_model.sql:72`). Postgres responde
   `update or delete on table "gardener_profiles" violates foreign key constraint
   "companies_provider_user_id_fkey" on table "companies"`, y Supabase lo enseña como el genérico
   «Database error deleting user».
3. Detrás hay un segundo freno: `company_members.company_id` también es `RESTRICT` (`:87`).
   No se puede borrar la empresa mientras tenga miembros.
4. Con los miembros y la empresa fuera, el usuario sí se borraría. Se comprobó en el mismo bloque
   deshecho y no hay más frenos.

Los frenos son **a propósito**. El diseño de F2 dice que las personas de una empresa «nunca se
borran: al salir pasan a inactive», para conservar el histórico (comentario de
`company_members`, `:98`). Lo que **no se diseñó** es qué pasa cuando hay que dar de baja la
cuenta entera: una cuenta de prueba, una empresa que se va o el derecho de supresión de datos.
Hoy la única vía es el panel de Supabase, que hace un borrado en bruto sin saber nada de
empresas.

**El problema contrario: lo que sí se borra deja restos.** Las columnas de personas que añadió
GarSer Empresas **no tienen clave foránea**: `company_members.user_id`,
`booking_blocks.assignee_id`, `company_applications.user_id` y `reviewer_id`, y
`company_invitations.created_by` y `accepted_by` (comprobado en la BD local, igual que
producción). Borrar un empleado o un solicitante deja filas que apuntan a nadie. En producción
ya hay:

- Una fila de miembro (empleado, inactivo desde el 2026-09-28 18:01) de una cuenta que ya no
  existe (`c18d4ce4-…`), y una invitación aceptada por esa misma cuenta.
- **Una solicitud de empresa «enviada»** (`company_applications`, 2026-09-25) de un usuario
  borrado (`af612d76-…`). El admin la ve como pendiente de revisar, y aprobarla fallaría porque
  la cuenta ya no existe (deducido del código: aprobar crea la ficha de proveedor de ese usuario;
  no se ha probado).
- Si se borrara un empleado con trabajos asignados, sus horas en `booking_blocks` quedarían a
  nombre de nadie, y el trabajo, sin persona que lo haga y sin aviso.

**Riesgo relacionado, más grave, anterior a empresas** (afecta también a autónomos y clientes).
`bookings.gardener_id` y `bookings.client_id` son `ON DELETE CASCADE`, igual que reseñas, pagos
en curso y planes de mantenimiento. Borrar desde Supabase a un autónomo o a un cliente con
historial **borra sus reservas pagadas**, y con ellas el rastro del dinero cobrado. Con una
empresa, eso hoy lo impide por casualidad el `RESTRICT` de arriba.

**Solución propuesta** (a confirmar en el plan de §3):

1. **Una sola vía segura para dar de baja una cuenta: «Eliminar cuenta» en el panel de admin de
   garser.es.** Sería una función del servidor que solo puede usar un admin. Antes de tocar nada,
   revisa y dice qué hay:
   - Sin historial (sin reservas ni pagos), como las cuentas de prueba: la borra entera en el
     orden correcto y en una sola transacción. Primero servicios de los miembros, miembros,
     invitaciones, empresa y solicitudes; después la cuenta, con `auth.admin.deleteUser`.
   - Con historial: **no borra**. Da de baja la cuenta: empresa suspendida, miembros inactivos,
     fuera del catálogo y sin poder iniciar sesión. Anonimiza los datos personales (nombre,
     teléfono, correo) y conserva las reservas y los importes.
   - Con trabajo pendiente (reservas futuras, pagos o reembolsos en curso, planes activos): se
     niega y dice cuáles son, para resolverlos antes.
2. **Que la base de datos no deje restos nunca**, pase lo que pase en el panel de Supabase:
   - Poner las claves foráneas que faltan, en modo `RESTRICT`: miembros, horas asignadas y
     solicitudes enviadas o aprobadas.
   - Borrar en cascada lo que no tiene valor histórico: borradores de solicitud, invitaciones
     pendientes y la marca de quién revisó, que pasa a `SET NULL`.
   - Cambiar `bookings.client_id` y `bookings.gardener_id` de `CASCADE` a `RESTRICT`, para que
     un borrado en bruto nunca se lleve reservas pagadas.
   - Un aviso claro cuando el borrado en bruto se frene (por ejemplo «Esta cuenta es la dueña de
     la empresa Jardines sa: dala de baja desde Admin → Usuarios»). Supabase seguirá enseñando su
     mensaje genérico, pero el motivo quedará en los registros de Postgres.
3. **Limpiar los restos que ya hay en producción** (con permiso): el miembro y la invitación de la
   cuenta borrada, y la solicitud de empresa huérfana. Antes de las claves foráneas, porque sin
   esa limpieza la migración no se podría aplicar.
4. **La cuenta `jrodgom1204@gmail.com`:** cuando exista la vía segura, borrarla desde ella. Hoy no
   tiene reservas, así que se borraría entera. Hay que tener en cuenta que es la única empresa de
   producción y que el usuario la está usando para probar.

**DECISIÓN PENDIENTE (producto).** Qué significa «eliminar» una cuenta que ya tiene reservas.
La propuesta es dar de baja y anonimizar, conservando las reservas y los importes, que son los
justificantes del dinero, en lugar de borrar. La alternativa sería no permitirlo nunca, y que el
admin solo pueda suspender. Se le pregunta al usuario al escribir el plan.

**Petición del usuario (2026-09-28): hay que crear un sistema para borrar o suspender empresas de
forma segura, que no deje sin hacer reservas ya citadas.** Es un requisito del plan de §3, no
una mejora opcional. Lo que tiene que cumplir:

- **Ninguna reserva citada se queda sin hacer en silencio.** Si la empresa tiene reservas
  confirmadas o pendientes con fecha futura, ni el borrado ni la suspensión pueden dejarlas
  huérfanas. La herramienta se niega y las enseña, para que se completen, se cancelen con
  reembolso y aviso al cliente, o se reasignen. Solo después se puede seguir.
- **Suspender** significa dejar de recibir reservas nuevas (fuera del catálogo y de los
  presupuestos) sin tocar las ya citadas, que se siguen pudiendo hacer, cobrar y valorar. Hoy
  existe `companies.status = 'suspended'`, pero hay que comprobar qué hace de verdad cuando se
  escriba el plan.
- **Borrar** solo se puede si no queda nada pendiente. Sin historial, se borra entero. Con
  historial, se aplica la decisión pendiente de arriba.
- Lo mismo vale para **dar de baja a un empleado** que tiene horas asignadas: primero se
  reasignan sus trabajos (F6), y después se le da de baja.

**Borrado puntual de la cuenta de prueba `jrodgom1204@gmail.com`** (2026-09-28, lo pidió el
usuario). Se hace con un script SQL de un solo bloque (todo o nada) que se para si la cuenta
tiene reservas, horas asignadas o planes. Si no, borra en orden: servicios de los miembros,
miembros, empresa (con sus invitaciones), solicitud de empresa y usuario (con su perfil, ficha y
precios). No tiene ficheros en Storage.

Antes se comprobó en producción con una prueba en seco, dentro de un bloque que se deshace: no
quedaba ninguna fila de la cuenta ni de la empresa. El script lo ejecuta el usuario en el editor
SQL de Supabase. Los restos antiguos (la solicitud huérfana `af612d76-…`) siguen pendientes para
el punto 3.

**Pruebas propuestas.**

- **Baterías locales** (`verify-account-deletion.mjs`):
  - Borrar desde la herramienta una empresa sin historial no deja ninguna fila de esa empresa
    ni de su dueño.
  - Con reservas pasadas, la da de baja y anonimiza, las reservas siguen y los importes no
    cambian.
  - Con una reserva futura o un pago en curso, se niega y dice cuál.
  - Un no-admin no puede usarla.
  - Borrar un empleado con horas asignadas, en bruto como hace el panel de Supabase, **falla**
    en vez de dejar restos.
  - Borrar en bruto un cliente con reservas pagadas **falla** en vez de llevárselas.
  - Un autónomo sin historial se sigue pudiendo borrar (Regla 2).
  - La consulta de restos devuelve 0.
- **Unitarias:** la pantalla de Admin → Usuarios enseña qué va a pasar (borrar, dar de baja o
  negarse, con el motivo) antes de confirmar.
- **En garser.es (P-R02-1):**
  - Tras la limpieza, la consulta de restos devuelve 0 en producción.
  - El usuario borra desde Admin → Usuarios una cuenta de prueba sin historial.
  - Intentar borrar desde el panel de Supabase una cuenta con reservas no se lleva nada.

### R-03 — Un botón para recargar las reservas (jardinero y cliente)

**Qué pide el usuario.** Un botón pequeño de recargar para que el jardinero vea las novedades
de sus reservas y el cliente vea el estado actualizado de las suyas.

**Por qué hace falta** (comprobado en el código):

- **Las listas de reservas solo se cargan al abrir la página.** No se refrescan al volver a la
  pestaña o a la app: no hay ningún `visibilitychange` ni `focus` en `src/`. Tampoco escuchan
  cambios en tiempo real: el tiempo real solo se usa en el chat (`useUnreadChats`, `ChatList`,
  `ChatWindow`, `chatService`).
- **Si la otra parte acepta, propone o cancela, la pantalla sigue enseñando lo de antes** hasta
  que se recarga a mano.
- **La web se instala como app** (`public/site.webmanifest`: `"display": "standalone"`). En la
  app instalada **no hay barra del navegador ni botón de recargar**, así que el usuario no tiene
  forma de refrescar, salvo cerrar la app.
- Pantallas afectadas:
  - Cliente: `/bookings` → `BookingsList` (`src/App.tsx:77`).
  - Jardinero autónomo y empresa: `/bookings` → `GardenerBookings` (`:52`) y «Solicitudes»
    (`BookingRequestsManager`).
  - Empresa: `/empresa` (agenda) y `/empresa/solicitudes`.
  - Empleado: `/mi-trabajo` (`useMyJobs`).

**Solución propuesta.**

1. **Un botón «Actualizar»** pequeño (icono de flechas, con texto accesible) en la cabecera de
   esas cinco pantallas. Vuelve a pedir los datos sin recargar la web entera, con un giro
   mientras carga y sin perder los borradores escritos. Es el mismo patrón que ya usan
   `ApplicationsAdmin` y `AvailabilityManager` (`RefreshCw`).
2. **Refresco automático** de esas listas al volver a la pestaña o a la app
   (`visibilitychange`), con un mínimo de unos 30 s entre refrescos. El botón queda para quien
   lo quiera usar, pero la pantalla ya no enseña datos viejos al volver.
3. **Opcional, a decidir en el plan:** escuchar en tiempo real los cambios de las reservas
   propias, igual que el chat, para que el estado cambie solo sin tocar nada.

**Pruebas.**

- **Unitarias:**
  - El botón vuelve a llamar a la carga y no borra un borrador de propuesta.
  - Volver a la pestaña recarga, y dos veces seguidas en menos de 30 s solo una vez.
- **Navegador local:**
  - Con el cliente en una pestaña y el jardinero en otra: el jardinero acepta, el cliente pulsa
    «Actualizar» y ve «Confirmada».
  - Igual al volver a la pestaña, sin pulsar nada.
- **En garser.es (P-R03-1):** con la app instalada en el móvil, el botón actualiza el estado.

### R-04 — Aviso a la empresa cuando un jardinero acepta la invitación

**Qué pide el usuario.** Cuando un jardinero invitado acepta, en el panel de la empresa tiene
que aparecer «*X* ha aceptado tu solicitud de unirse a tu equipo. Configura su perfil para que
pueda realizar servicios dentro de tu empresa», con un botón para configurarlo. El aviso sigue
ahí hasta que ese jardinero tenga un **horario fijo** y **al menos un servicio activo**.

**Qué hay hoy** (código):

- **Al aceptar la invitación no se avisa a la empresa**, ni en el panel ni por correo. No hay
  ningún tipo de correo `invitation_accepted` en `send-email-notification` (tiene 22 tipos; la cabecera de `index.ts:7-15` resume los principales).
- En «Equipo», la tarjeta del empleado dice «Sin servicios asignados»
  (`TeamMemberCard.tsx:120-121`), pero nada indica que le falta el horario.
- `company_team_overview` (lo que carga el equipo, `useCompanyTeam.ts:44`) devuelve los
  servicios de cada miembro, pero **no si tiene horario fijo**.
- La consecuencia real: un empleado sin servicio o sin horario **nunca recibe trabajos**. La
  venta solo aparta a quien hace el servicio y está libre (A-29). Nadie avisa a la empresa, que
  puede pensar que la web no le reparte trabajo.
- El panel de la empresa ya tiene un aviso parecido, «Aún no ofreces ningún servicio»
  (`CompanyHomePage.tsx:143-146`), que se puede tomar como modelo.

**Solución propuesta.**

1. `company_team_overview` devuelve, por empleado activo, `has_recurring_schedule` (tiene
   reglas en `recurring_schedules`) y `active_services_count`. Así el servidor decide si está
   configurado y la pantalla no lo deduce.
2. En el panel de la empresa (`/empresa`), **un aviso por cada empleado sin configurar**, con el
   texto que pide el usuario y un botón «Configurar a *X*». El botón lleva a lo que falte: su
   horario (`/empresa/equipo/:memberId/horario`) o sus servicios en «Equipo». El aviso dice qué
   le falta («Le falta: horario fijo · servicios») y **desaparece solo** cuando tiene las dos
   cosas. No hace falta guardar un «visto»: se calcula cada vez.
3. **Un correo al dueño** cuando el jardinero acepta, con el mismo texto y un enlace al panel.
   Sale del servidor, desde `company-invitation-signup` y la aceptación con cuenta existente, y
   no del navegador (ver R-06, punto 3).
4. Criterio de «configurado», a confirmar con el usuario: el horario fijo cuenta si tiene al
   menos una franja semanal. Unos días sueltos sin horario fijo no cuentan.

**Pruebas.**

- **Batería local:**
  - Invitar y aceptar: el aviso sale en el panel y llega el correo al dueño.
  - Con solo servicio sigue saliendo; con solo horario, también; con los dos, desaparece.
  - Un empleado inactivo no sale.
  - Otra empresa no ve los empleados de esta.
- **Unitarias:** el aviso con cada combinación y el destino del botón.
- **En garser.es (P-R04-1):** invitar a una cuenta nueva, aceptar, ver el aviso, configurar el
  horario y un servicio, y ver que el aviso se va.

### R-05 — Correo al trabajador cuando la empresa le cambia el horario

**Qué pide el usuario.** Cuando la empresa modifique el horario de un trabajador, a este le
llega un correo: «Tienes un nuevo horario publicado».

**Qué hay hoy** (código):

- El dueño guarda el horario de un empleado por dos vías (D22):
  - El horario fijo semanal, con `set_member_recurring_schedule`
    (`RecurringScheduleManager.tsx:259`).
  - Los ajustes de días sueltos, con `set_member_day_availability`, que se llama **una vez por
    cada día cambiado** (`AvailabilityManager.tsx:258-266`).
- Ninguna de las dos avisa al empleado.

**Solución propuesta.**

1. **Un correo nuevo, `member_schedule_published`**, «Tu empresa ha publicado tu nuevo
   horario», que dice qué ha cambiado y enlaza a «Mi trabajo → Horario»:
   - Horario fijo: el resumen semanal nuevo (por ejemplo «lunes a viernes de 9:00 a 14:00»).
   - Días sueltos: la lista de días cambiados y sus horas.
2. **Un solo correo por cada vez que se pulsa «Guardar»**, no uno por día. Los ajustes de días
   sueltos se guardarán en una sola llamada con todos los días
   (`set_member_days_availability(p_member_id, p_days jsonb)`). Esa llamada es además todo o
   nada, así que ya no puede quedar un horario guardado a medias.
3. El correo sale del servidor, desde las propias funciones de guardar, y no del navegador
   (R-06, punto 3). No se envía si en realidad no ha cambiado nada, ni cuando el dueño cambia su
   propio horario.
4. Con R-08, además, como notificación al móvil.

**Pruebas.**

- **Batería local:**
  - Guardar el horario fijo: sale 1 correo con el resumen.
  - Guardar 5 días sueltos: sale 1 correo con los 5 días.
  - Guardar sin cambios no manda nada.
  - Un dueño de otra empresa no puede cambiar el horario ni provocar el correo.
- **En garser.es (P-R05-1):** el dueño cambia el horario del empleado y le llega un solo correo.

### R-06 — Al enviar una propuesta de precio se cerró la sesión de la empresa

**Qué vio el usuario.** Desde la cuenta de empresa, en una solicitud pulsó «Enviar propuesta al
cliente» con nuevo precio, duración y motivo. La web le cerró la sesión. En la consola salieron:

- `GET /auth/v1/user 403`.
- `rpc/expire_stale_booking_requests 400` con «Debes iniciar sesión».
- `functions/v1/send-email-notification 403`.

Al volver a entrar, la propuesta estaba enviada y el cliente la tenía, pero la solicitud decía
«Hace 1 hora» cuando era de hacía minutos.

**Causa exacta** (comprobada en producción con el registro de Auth, `auth.audit_log_entries`,
2026-09-28, horas en UTC). Cuenta de empresa `javieerrodriguez1204@gmail.com`, reserva
`f3bc0b82-…`:

| Hora | Qué pasa |
|---|---|
| 19:00:01 y 19:00:35 | Dos inicios de sesión de la cuenta de empresa: dos sesiones, en dos pestañas o dispositivos. |
| **19:19:36** | **`logout` de la cuenta de empresa**, en uno de los dos sitios. |
| 19:20:26 y 19:20:27 | Se crea la cuenta `jrodgom1204@…` por la invitación (`company-invitation-signup`) e inicia sesión. Es decir, se cerró la sesión de la empresa para aceptar la invitación como empleado. |
| 19:30:09 | El cliente crea la solicitud. |
| 19:33:21 | Se guarda la propuesta de precio. La llamada funcionó. |
| (justo después) | La web pide `/auth/v1/user` → **403**: la sesión ya no existe. Supabase borra la sesión del navegador y la web te saca. |
| 19:36:16 | Vuelves a entrar. Queda una sola sesión, en el móvil. |

1. **Cerrar sesión en GarSer cierra la sesión en TODOS los dispositivos.** Todas las llamadas a
   `supabase.auth.signOut()` van sin opciones, y en supabase-js 2.57 eso es
   `{ scope: 'global' }` (`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:1378`):
   revoca todas las sesiones del usuario. Las llamadas están en `AuthContext.tsx:171`, `:216` y
   `:227` (el `signOut` que usan `Navbar.tsx:30`, `MyAccount.tsx:116`, `GardenerStatusPage.tsx:19`
   y `CompanyStatusPage.tsx:61`), `AdminLayout.tsx:38` e `InvitationAcceptPage.tsx:188` y `:311`.
   El botón de la invitación «No soy yo: cerrar sesión» (`:311`) existe justo para abrir el enlace
   en un móvil con la sesión de la empresa. Al pulsarlo, **cierra también la empresa en el
   ordenador**.
2. **La pestaña que seguía abierta no se entera hasta que habla con Auth.** Su token de acceso
   sigue valiendo hasta que caduca (1 h), así que la propuesta se guardó bien. Pero la primera
   comprobación contra Auth (`getUser`) devuelve 403 y supabase-js cierra la sesión local de
   golpe, **sin ningún aviso**. Para el usuario parece un fallo de la web.
3. **Se perdió el correo de la propuesta al cliente.** Después de guardar, el navegador pide el
   correo a `send-email-notification` (`bookingPriceChangeService.ts:35`). La función comprueba
   al que llama con `getUser` (`send-email-notification/index.ts:182` y `:242`) y, con la sesión
   revocada, responde **403**. El cliente vio la propuesta en la web, pero **muy probablemente no
   le llegó el correo** (a confirmar con el usuario). Es un defecto de diseño que va más allá de
   este caso: **16 correos los pide el navegador después de la acción**
   (`grep "invoke('send-email-notification'" src`). Si la pestaña se cierra, se pierde la
   conexión o caduca la sesión en ese momento, la acción queda hecha y el correo no sale nunca.
4. **«Hace 1 hora» a los pocos minutos.** `getBookingStatus` redondea las horas **hacia arriba**:
   `Math.ceil(...)` en `BookingRequestsManager.tsx:476`. Un segundo después de llegar ya da 1, y
   «Recién recibida» (`:478`) no sale nunca. Igual con los días: a las 25 h dice «Hace 2 días».
   Afecta también a los autónomos, porque es la misma pantalla. No tiene que ver con la zona
   horaria.

**Solución propuesta.**

1. **Cerrar sesión solo en este dispositivo:** `signOut({ scope: 'local' })` en todas las
   salidas normales, y en la invitación, el registro y la cuenta sin verificar. Cerrar todas las
   sesiones (`global`) quedaría solo para cuando hace falta de verdad: cambio o restablecimiento
   de contraseña y un botón explícito «Cerrar sesión en todos mis dispositivos» en «Mi cuenta».
2. **Si la sesión se cierra desde fuera, decirlo y no perder el trabajo.**
   - Distinguir un `SIGNED_OUT` que no ha pedido el usuario.
   - Enseñar «Tu sesión se ha cerrado (por ejemplo, desde otro dispositivo). Vuelve a entrar
     para continuar».
   - Llevar a `/auth` con vuelta a la misma página (`redirectTo`).
   - Conservar los borradores escritos (propuesta, motivo).
3. **Que los correos no dependan del navegador** (cambio de diseño: Regla 7, se decide con el
   usuario en el plan).
   - Las funciones del servidor que hacen la acción (proponer precio, aceptar, cancelar,
     asignar, etc.) apuntan el aviso en una tabla de pendientes (`notification_outbox`), **en la
     misma transacción** que la acción.
   - Un proceso del servidor (reloj de `pg_cron` o disparador hacia una función) los envía con
     reintentos y marca cada uno como enviado. Si falla la sesión, la red o se cierra la
     pestaña, el correo sale igual y sale una sola vez.
   - Es también la base de R-05, R-07 y R-08: el mismo aviso se manda por correo y al móvil.
4. **Tiempo relativo correcto:** redondear hacia abajo y usar minutos por debajo de una hora
   («Hace 5 min», «Hace 1 hora» a partir de 60 min, «Hace 1 día» a partir de 24 h).

**Pruebas.**

- **Unitarias:**
  - Cerrar sesión llama a `signOut` con `scope: 'local'`.
  - Un `SIGNED_OUT` que no ha pedido el usuario enseña el aviso y lleva a `/auth` con vuelta.
  - `getBookingStatus` a los 30 s, 5 min, 59 min, 61 min, 23 h y 25 h.
- **Batería local:**
  - Dos sesiones de la misma cuenta: cerrar una no invalida la otra, que sigue pudiendo pedir
    `getUser` y llamar a funciones.
  - Proponer un precio deja un aviso en la tabla de pendientes en la misma transacción. El
    proceso lo envía una vez y, si se relanza, no lo repite.
  - Si la llamada del navegador no llega, el correo sale igualmente.
- **En garser.es (P-R06-1):**
  - Empresa abierta en el ordenador y en el móvil. Cerrar sesión en el móvil y enviar una
    propuesta en el ordenador: no se cierra la sesión y al cliente le llega el correo.
  - Una solicitud recién llegada dice «Hace X min».

### R-07 — El empleado ve el trabajo antes de que el dueño lo acepte

**Qué pide el usuario.**

- Mientras la empresa no ha aceptado la solicitud, al jardinero **no** le tiene que aparecer
  como «Por confirmar». Solo le aparece cuando el trabajo ya está confirmado y asignado a él.
- En ese momento **le llega un correo**.

**Causa exacta** (código):

- La venta ya aparta a una persona (A-29, `booking_blocks.assignee_id`), incluso con la reserva
  `pending`.
- `my_jobs`, lo que carga «Mi trabajo», devuelve las reservas con
  `b.status IN ('pending', 'confirmed', …)` y un bloque de esa persona
  (versión vigente en `supabase/migrations/20260926130000_empresas_f8_service_label.sql:132`). **No mira ni la aceptación del dueño ni `assignment_pending`**
  (en modo manual, la persona es solo una propuesta que el dueño todavía no ha decidido).
- `JobCard.tsx:103-104` pinta esas reservas pendientes con la etiqueta «Por confirmar».

**El correo existe, pero hay caminos en los que no sale.** `job_assigned` («Te han asignado un
trabajo») lo pide el navegador:

- Al aceptar en «Solicitudes» (`BookingRequestsManager.tsx:348-353`).
- Al asignar o cambiar a mano (`AssignWorkerControl.tsx:65`, `JobSheet.tsx:76`,
  `TeamJobSection.tsx:39`).

Pero **no sale cuando la reserva se confirma porque el cliente acepta una propuesta de precio o
de duración**. `respond_booking_price_change` confirma la reserva y el navegador del cliente
solo avisa al proveedor (`bookingPriceChangeService.ts:95-105`). Es justo el caso del usuario:
la reserva `f3bc0b82-…` quedó confirmada a las 19:38 con `jrodgom1204@…` asignado (modo
`auto`), y a él no le llegó nada. Además, como todos los de R-06, depende del navegador.

**Solución propuesta.**

1. `my_jobs` y lo que el empleado ve de su agenda solo devuelven un trabajo cuando
   `status IN ('confirmed', 'in_progress', 'completed', 'disputed')` **y** `assignment_pending =
   false`. La etiqueta «Por confirmar» de `JobCard` desaparece, porque deja de tener sentido.
   Las horas siguen apartadas a esa persona mientras tanto; solo no se le enseña el trabajo. En
   su horario, esas horas salen como «reservadas», sin datos del cliente, para que no parezcan
   libres.
2. **Un único momento de aviso, decidido en el servidor:** cuando una reserva pasa a confirmada
   con su persona decidida, o cuando se decide o cambia la persona de una reserva confirmada, se
   apunta `job_assigned` para cada persona nueva y `job_unassigned` para quien sale. Va en la
   tabla de pendientes de R-06, sea cual sea el camino: el dueño acepta, el cliente acepta una
   propuesta, se confirma una asignación manual o se reparte a un equipo. Se quitan las llamadas
   sueltas del navegador.
3. Idempotente: el mismo trabajo no avisa dos veces a la misma persona si no ha cambiado nada.

**Pruebas.**

- **Batería local (`verify-employee-visibility.mjs`):**
  - Reserva pendiente: el empleado no la ve en `my_jobs`.
  - El dueño acepta: la ve y le llega 1 correo.
  - Modo manual con persona sin decidir: no la ve aunque esté confirmada; el dueño la decide y
    la ve, con su correo.
  - El cliente acepta una propuesta de precio: el empleado recibe el correo, el caso de hoy.
  - Se cambia la persona: correo a la nueva y aviso a la anterior.
  - Repetir la acción no manda correos duplicados.
  - El autónomo no cambia (Regla 2).
- **En garser.es (P-R07-1):** una solicitud nueva a la empresa no aparece en «Mi trabajo» del
  empleado. Al aceptarla aparece y le llega el correo, también si se confirma por una propuesta
  de precio.

### R-08 — Notificaciones al móvil de todo lo que se manda por correo

**Qué pide el usuario.** Que todos los avisos que hoy llegan por correo lleguen también como
notificación de la app al teléfono, a todos los usuarios: clientes, autónomos, empresas y
empleados.

**Qué hay hoy** (código):

- **No hay notificaciones al móvil.** La web se puede instalar (`public/site.webmanifest`,
  `display: standalone`, iconos; `index.html:25-29`). Pero no tiene *service worker* ni push:
  no hay `serviceWorker`, `PushManager` ni `web-push` en `src/`, `public/` ni la configuración
  de Vite. Tampoco hay app nativa.
- Los correos salen de tres funciones:
  - `send-email-notification`: 22 tipos, 16 pedidos desde el navegador.
  - `booking-confirmation-email`: reserva confirmada, a las dos partes.
  - `booking-lifecycle-tick`: recordatorios y caducidades, desde el reloj.

**Solución propuesta.**

1. **Un único sitio que decide los avisos:** la tabla de pendientes de R-06. Cada aviso tiene
   destinatario, tipo y datos, y se envía por **cada canal** que tenga el usuario (correo y
   móvil). Añadir el móvil es una sola pieza, no 25 sitios.
2. **Notificaciones push web (PWA).**
   - *Service worker* en la web y claves VAPID en el servidor.
   - Tabla `push_subscriptions` por usuario y dispositivo, con RLS «solo las tuyas».
   - Función que envía con `web-push` y borra las suscripciones caducadas (410).
   - Botón «Activar notificaciones» en «Mi cuenta» y un aviso tras la primera reserva. El
     navegador exige que lo pulse el usuario.
   - Al tocar la notificación, se abre la pantalla de esa reserva.
3. Preferencias por usuario (por ejemplo, desactivar el móvil y dejar solo el correo), si el
   usuario lo quiere.

**Límites que el usuario tiene que conocer** (a decidir en el plan):

- **Android** (Chrome y otros): funciona con la web, sin instalar nada.
- **iPhone**: solo funciona si el usuario **añade GarSer a la pantalla de inicio** (iOS 16.4 o
  posterior) y activa las notificaciones desde esa app instalada. Desde Safari sin instalar, no.
  Habría que enseñar cómo instalarla.
- La alternativa es una **app nativa** en las tiendas (por ejemplo, empaquetar la web con
  Capacitor y usar Firebase y APNs). Funciona en todos los iPhone sin instalar desde la web,
  pero exige cuentas de desarrollador, publicación y revisión de Apple y Google. Es un proyecto
  aparte.

**DECISIÓN PENDIENTE (producto).** ¿Push web (PWA), recomendado para empezar porque sirve para
la web actual sin tiendas, o app nativa? ¿Todos los avisos al móvil, o solo los que piden
actuar (solicitud nueva, propuesta, cambio de fecha, trabajo asignado, recordatorio)?

**Pruebas.**

- **Unitarias:** registro de la suscripción, botón de activar y la notificación abre la
  pantalla correcta.
- **Batería local:**
  - Cada tipo de aviso crea una notificación por cada suscripción del destinatario y ninguna
    para otros usuarios.
  - Una suscripción caducada se borra.
  - Sin suscripción, solo sale el correo.
- **En garser.es (P-R08-1):**
  - Android: activar notificaciones, hacer una reserva y que llegue al jardinero y al cliente.
  - iPhone: instalada en la pantalla de inicio, lo mismo.

---

## 3. Plan de implementación

> Aprobado el alcance el 2026-09-28: **se corrige todo menos los malos diagnósticos** (R-01a y la
> parte de R-02 que era un freno a propósito). Rama `fix/prueba-real-r01-r08`, desde `main`
> (`39c8308`, tras la PR #40). Línea base: **558 pruebas / 86 ficheros**, `tsc` en 128.

### 3.1 Decisiones del usuario (2026-09-28)

| # | Pregunta | Decisión |
|---|---|---|
| D23 | R-02: eliminar una cuenta que ya tiene reservas | **Dar de baja y anonimizar.** La cuenta no puede entrar y sale del catálogo, sus datos personales se borran, y se conservan las reservas y los importes. Sin historial, se borra entera. Las reservas futuras o con pagos en curso **siempre bloquean**. |
| D24 | R-06: quién envía los correos | **El servidor.** Cada acción deja el aviso apuntado en la base de datos en la misma transacción, y un proceso del servidor lo envía con reintentos. |
| D25 | R-08: cómo llegan los avisos al móvil | **Notificaciones web (PWA)**, de **todos** los avisos que hoy se mandan por correo. |
| D26 | R-03: tiempo real en las reservas | **No.** Botón «Actualizar» y refresco al volver a la app. |

Decisiones técnicas tomadas por el chat (reversibles, §5 de la guía):

- R-04: «configurado» significa **al menos una franja semanal en el horario fijo** y **al menos
  un servicio asignado**.
- El **correo de invitación** a un empleado se sigue pidiendo desde el navegador del dueño. El
  enlace lleva el código de la invitación en claro, que la base de datos solo guarda cifrado, y
  no se va a guardar en claro en una cola. Se le añaden reintentos y el botón «Reenviar» que ya
  existe.

### 3.2 Hallazgos nuevos del análisis (se corrigen en este plan)

| # | Hallazgo | Tipo | Fase |
|---|---|---|---|
| R-09 | `companies.status = 'suspended'` existe en el esquema, pero **ninguna función lo mira**: una empresa «suspendida» seguiría vendiendo. No hay ninguna forma de suspender a un proveedor. | Funcionamiento | F6 |
| R-10 | El empleado puede leer los datos del cliente (dirección, teléfono, qué hay que hacer) de un trabajo **todavía pendiente o sin asignar del todo**: `is_booking_assignee` (`20260925140000_empresas_f5_assign_and_work.sql`) solo mira que tenga horas apartadas, no el estado de la reserva. Lo usan `can_read_booking_items` (`20260926120000_empresas_f8_booking_items.sql:49`) y el detalle y «he terminado» de F5. | **Seguridad y privacidad** (mínimo privilegio, A-33) | F4 |
| R-11 | El correo «tu propuesta ha caducado» (`booking_price_change_expired`) tiene plantilla, pero **nada lo envía**: ni el reloj nuevo `expire-price-change-proposals` ni la caducidad perezosa. El jardinero no se entera de que su propuesta caducó. | Funcionamiento | F3 |
| R-12 | Borrar desde Supabase a un **cliente o autónomo con reservas pagadas se lleva sus reservas**, por el `ON DELETE CASCADE` de `bookings.client_id` y `bookings.gardener_id` y de lo que cuelga de ellas. Es anterior a empresas (ver R-02). | **Datos y dinero** | F6 |
| R-14 | En el móvil, el panel de admin **no tiene botón de cerrar sesión**: solo estaba en la barra lateral, que se oculta por debajo de 768 px (`AdminLayout.tsx`). Visto al probar F1. | Diseño / UX | F1 (hecho) |
| R-15 | El botón de salir de la barra superior en el móvil es solo un icono **sin nombre accesible**: un lector de pantalla lo anuncia como «botón» (`Navbar.tsx`). | Accesibilidad | F2 (hecho) |
| R-16 | **El navegador podía cambiar el estado de una reserva** (`bookings.status`) por PostgREST: regla «Participants can update bookings» + `GRANT UPDATE (status)` (`20260713000001`). Comprobado en local: el jardinero pasa su reserva de `pending` a `confirmed` y a `completed` sin la aceptación del cliente ni el cobro de los gastos de gestión, y el cliente podría cancelar saltándose la política de cancelación. | **Seguridad y dinero (crítica)** | F3 (hecho) |
| R-17 | El correo al jardinero cuando el cliente **rechaza** su propuesta decía «La reserva continúa con el precio original», pero rechazar **cancela** la solicitud (`respond_booking_price_change`). | Funcionamiento (correo engañoso) | F3 (hecho) |
| R-13 | Restos en producción de cuentas borradas: una solicitud de empresa «enviada» huérfana (`af612d76-…`), que el admin ve como pendiente y no puede aprobar. | Datos | F6 |

### 3.3 Fases

Orden por dependencias: F3 (sistema de avisos) es la base de F4, F5 y F7. Cada fase se cierra con
la Regla 4 de la guía:

- `npm test` con el mismo número de pruebas o más.
- `npm run build` sin errores.
- `tsc` sin pasar de 128 errores.
- Las baterías locales afectadas en verde.
- **Prueba en el navegador local**, con captura.
- Este documento actualizado en §4 (registro) y un commit.

#### F1 — Sesiones y tiempos (R-06 a, b y d; R-01b)

- **Cerrar sesión solo en este dispositivo.** Todas las salidas normales pasan a
  `signOut({ scope: 'local' })`. Son las de `AuthContext.tsx` (`:171`, `:216` y `:227`, que usan
  Navbar, «Mi cuenta», el estado del jardinero y el de la empresa), `AdminLayout.tsx:38` e
  `InvitationAcceptPage.tsx:188` y `:311`. Se queda en `global` solo tras restablecer la
  contraseña, y se añade un botón explícito «Cerrar sesión en todos mis dispositivos» en «Mi
  cuenta».
- **Sesión cerrada desde fuera.** `AuthContext` distingue un `SIGNED_OUT` que no ha pedido el
  usuario (una marca que pone el propio `signOut`). En ese caso enseña «Tu sesión se ha cerrado,
  por ejemplo desde otro dispositivo. Vuelve a entrar para continuar» y lleva a `/auth` con
  `redirectTo` a la página en la que estaba. Los borradores de la propuesta de precio no se
  pierden: se guardan en `sessionStorage` por reserva mientras se escriben.
- **«Hace X».** `getBookingStatus` (`BookingRequestsManager.tsx:473-484`) pasa a una utilidad
  compartida y probada:
  - «Recién recibida» por debajo de 1 min.
  - «Hace N min» por debajo de 1 h.
  - «Hace N h» por debajo de 24 h.
  - «Hace N días» a partir de ahí.

  Siempre redondea hacia abajo. Se cambia también en cualquier otro sitio con el mismo cálculo
  (se buscará `Math.ceil` junto a `1000 * 60 * 60`).
- **R-01b.**
  - Tras iniciar sesión, cada cuenta va directamente a su panel: el admin, a `/admin/dashboard`.
  - `useUnreadChats` no abre canal para el admin.
  - Un solo canal de «sin leer» compartido por `Navbar` y `BottomNav`, con un contador de uso en
    un módulo.
  - Los `console.log` de diagnóstico de `AuthContext` solo salen en desarrollo
    (`import.meta.env.DEV`).
- **Pruebas.**
  - Unitarias:
    - `signOut` con `scope: 'local'`.
    - `SIGNED_OUT` no pedido → aviso y `redirectTo`.
    - Utilidad de tiempo: 30 s, 5 min, 59 min, 61 min, 23 h, 25 h y 49 h.
    - Destino tras iniciar sesión por tipo de cuenta.
    - Canal de chats: uno solo con dos barras, ninguno para el admin.
  - Batería: la misma cuenta con dos sesiones. Cerrar una deja la otra válida (`getUser` y una
    función con su token).
  - Navegador local:
    - Admin: la consola queda limpia al entrar.
    - Empresa en dos pestañas aisladas: cerrar sesión en una no saca a la otra.
    - Forzar la revocación de la sesión: aparece el aviso y se vuelve a la misma página.
    - Una solicitud recién creada dice «Recién recibida».

#### F2 — Recargar reservas (R-03, D26)

- **Hook compartido `useRefreshOnReturn(load, { minIntervalMs: 30000 })`.** Recarga al volver a la
  pestaña o a la app (`visibilitychange` a `visible` y `pageshow` desde la caché del navegador),
  sin repetir si ya hay una carga en curso.
- **Componente `RefreshButton`**: icono `RefreshCw`, gira mientras carga, con `aria-label`
  «Actualizar» y un área de toque de 44 px. Va en la cabecera de:
  - `BookingsList` (cliente).
  - `GardenerBookings` y `BookingRequestsManager` (autónomo y empresa).
  - La agenda de `/empresa` y `/empresa/solicitudes`.
  - `/mi-trabajo` (`useMyJobs`).
- Recargar **no borra lo escrito** (borradores de propuesta, motivo) ni cierra una ficha abierta.
- **Pruebas.**
  - Unitarias:
    - El hook recarga al volver y respeta los 30 s.
    - El botón llama a la carga, se desactiva mientras carga y conserva el borrador.
  - Navegador local: cliente y jardinero en contextos separados. El jardinero acepta; el
    cliente pulsa «Actualizar» y ve «Confirmada». Luego, lo mismo cambiando de pestaña sin
    pulsar nada. Captura a 375 px del botón en cada pantalla.

#### F3 — Los avisos los envía el servidor (R-06 c, R-11, D24)

Es la base de F4, F5 y F7. **Cambia el diseño** (decidido por el usuario, D24); se anota como
A-34 en `02-HALLAZGOS.md`.

- **Tabla `notification_outbox`.**
  - Columnas: `id`, `type`, `booking_id` y otras referencias, `payload jsonb`, `dedupe_key`
    (única), `status` (`pending`, `sending`, `sent` o `failed`), `attempts`,
    `next_attempt_at`, `last_error`, `created_at` y `sent_at`.
  - Sin acceso para `anon` ni `authenticated`: RLS activado y sin reglas.
  - Solo la escriben funciones `SECURITY DEFINER` y *triggers*.
- **Quién apunta los avisos.** *Triggers* `AFTER` sobre cambios de estado reales (`OLD` frente a
  `NEW`), así que valen para cualquier camino (web, RPC, reloj o admin):

  | Cambio | Aviso (el mismo correo de hoy) |
  |---|---|
  | `bookings.price_change_status` pasa a `pending_client_acceptance` | `booking_price_change_proposed` |
  | … a `accepted`, `rejected` o `expired` | `…_accepted`, `…_rejected` y `…_expired` (**R-11**) |
  | `bookings.status` pasa de `pending` a `confirmed` (acepta el proveedor) | `booking_accepted` |
  | `bookings.status` pasa a `rejected` o a `cancelled` | `booking_rejected` y `booking_cancelled` |
  | `bookings.reschedule_status` pasa a `pending_client` o a una respuesta | `booking_reschedule_proposed` y `_answered` |
  | Alta en `booking_incidents` | `booking_incident_received` |
  | `gardener_applications.status` y `company_applications.status` pasan a `approved` o `rejected` | `gardener_…` y `company_approved` o `company_rejected` |

  - La lista exacta de transiciones se saca de lo que hoy dispara cada una de las 16 llamadas
    del navegador. No se inventan correos nuevos en esta fase, salvo R-11.
  - `dedupe_key` (por ejemplo `tipo:reserva:marca de la transición`) impide duplicados si la
    misma transición se repite.
- **Quién los envía: función nueva `notification-dispatch`.**
  - La llaman `pg_net` justo al apuntar un aviso (un *trigger* `AFTER INSERT` sobre la cola,
    asíncrono, que no frena la transacción) y un reloj `pg_cron` cada minuto que recoge lo
    atrasado.
  - Se autoriza con un secreto guardado en Vault, igual que `booking-lifecycle-tick`
    (`20260827120000_lifecycle_tick_cron.sql`).
  - Reclama avisos con `FOR UPDATE SKIP LOCKED`, el mismo patrón que
    `claim_maintenance_notifications` (F9), para que dos pasadas no manden el mismo.
  - Para cada aviso llama a `send-email-notification` como servicio interno
    (`isInternalServiceCaller`). Es el único sitio que redacta los correos, así que no se duplica
    ninguna plantilla.
  - Si falla, reintenta con espera creciente: 1, 5, 15 y 60 min, hasta 5 intentos. Después queda
    en `failed`, visible para el admin.
- **Retirar las llamadas del navegador** a los tipos que pasan a la cola: `bookingPriceChangeService`,
  `bookingRescheduleService`, `bookingIncidentService`, `bookingRequestService`,
  `RescheduleSection`, `ApplicationsAdmin` y `CompanyApplicationsAdmin`. Las de trabajos de
  empresa se retiran en F4. Se queda la de la invitación, con reintentos (decisión de §3.1).
- **Sin duplicados mientras se despliega.** `send-email-notification` rechaza con
  `{ skipped: 'server_managed' }` las llamadas **del navegador** a esos tipos cuando la cola ya
  existe. Orden de despliegue:
  1. La función, que sin la cola sigue enviando como ahora.
  2. La migración.
  3. La web.

  Así una pestaña con la web vieja no manda el correo dos veces.
- **Pruebas.**
  - Batería `verify-notification-outbox.mjs`:
    - Cada transición deja exactamente 1 aviso con el tipo correcto.
    - Repetirla no deja otro.
    - Proponer con la sesión revocada: el aviso está en la cola aunque el navegador no llame a
      nada (el caso de hoy).
    - El envío lo marca `sent`.
    - Un fallo simulado reintenta y a los 5 intentos queda `failed`.
    - Dos envíos a la vez no mandan el mismo aviso dos veces.
    - Una llamada del navegador a un tipo gestionado devuelve `skipped`.
    - Un usuario normal no puede leer ni escribir la cola.
    - Caducar una propuesta manda `…_expired` (R-11).
    - El autónomo recibe los mismos correos que antes (Regla 2).
  - Unitarias: las pantallas ya no llaman a `send-email-notification` salvo la invitación.
  - Navegador local: proponer un precio, aceptar y cancelar; ver en la cola que cada aviso queda
    `sent`, y en el registro de la función de correo local que se ha enviado uno por acción.

#### F4 — El empleado solo ve lo suyo y confirmado (R-07, R-10)

- `my_jobs` y la agenda del empleado solo devuelven trabajos con
  `status IN ('confirmed', 'in_progress', 'completed', 'disputed')` y
  `assignment_pending = false`. Sus horas apartadas siguen bloqueadas: en su horario salen como
  «reservadas», sin datos del cliente. Se quita la etiqueta «Por confirmar» de
  `JobCard.tsx:103-104`.
- **R-10.** `is_booking_assignee` exige lo mismo: reserva en esos estados y sin
  `assignment_pending`. Así el detalle, `can_read_booking_items` y «he terminado» se cierran al
  mismo tiempo.
- **Aviso al empleado desde el servidor** (sobre F3). Un *trigger* apunta `job_assigned` a cada
  persona nueva y `job_unassigned` a quien sale, en dos casos:
  - Cuando la reserva pasa a confirmada con su persona decidida, sea cual sea el camino: acepta
    el dueño, acepta el cliente una propuesta (el caso de hoy), se confirma la asignación manual
    o se reparte un equipo.
  - Cuando cambian las personas de una reserva ya confirmada.

  `dedupe_key` por reserva y persona, así que no se repite si no cambia nada. Se retiran las
  llamadas del navegador de `BookingRequestsManager.tsx:348-353`, `AssignWorkerControl.tsx:65-67`,
  `JobSheet.tsx:76-79` y `TeamJobSection.tsx:39-42`.
- **Pruebas.**
  - Batería `verify-employee-visibility.mjs`:
    - Pendiente: el empleado no la ve y no puede abrir el detalle (R-10).
    - El dueño acepta: la ve y le llega 1 aviso.
    - Modo manual sin decidir: no la ve aunque esté confirmada; al decidir, la ve y le llega su
      aviso.
    - El cliente acepta una propuesta de precio: le llega el aviso.
    - Cambio de persona: aviso a la nueva y a la anterior.
    - Repetir no duplica.
    - El autónomo no cambia.
    - `verify-f5-*`, `verify-f6-*` y `verify-f7-*` siguen en verde.
  - Navegador local: una solicitud nueva no aparece en «Mi trabajo»; se acepta y aparece, sin
    «Por confirmar».

#### F5 — Equipo: aviso de configurar y correo de horario (R-04, R-05)

- **R-04.**
  - `company_team_overview` devuelve por empleado activo `has_recurring_schedule` y
    `is_configured`.
  - En `/empresa`, un aviso por cada empleado sin configurar: «*X* ha aceptado tu solicitud de
    unirse a tu equipo. Configura su perfil para que pueda realizar servicios dentro de tu
    empresa», con lo que le falta («Le falta: horario fijo · servicios») y el botón «Configurar».
    El botón lleva a su horario (`/empresa/equipo/:memberId/horario`) o a sus servicios en
    «Equipo». Desaparece solo cuando está configurado.
  - Correo nuevo `company_member_joined` al dueño, apuntado en la cola cuando el miembro pasa a
    activo (invitación aceptada, con cuenta nueva o existente).
- **R-05.**
  - Los ajustes de días sueltos del dueño se guardan en **una sola llamada**:
    `set_member_days_availability(p_member_id, p_days jsonb)`, todo o nada, con las mismas
    comprobaciones que `set_member_day_availability`. `AvailabilityManager` la usa cuando el
    horario es de un empleado.
  - Esa llamada y `set_member_recurring_schedule` apuntan **un** aviso
    `member_schedule_published` al empleado, **solo si algo ha cambiado**. El correo resume el
    horario fijo nuevo o los días cambiados y enlaza a «Mi trabajo → Horario».
- **Pruebas.**
  - Batería `verify-team-setup.mjs`:
    - Aceptar deja el aviso al dueño y `is_configured = false`.
    - Solo servicio o solo horario sigue en `false`; con los dos, `true`.
    - Guardar 5 días deja 1 aviso; guardar sin cambios, 0.
    - Guardar el horario fijo deja 1 aviso.
    - Otra empresa no puede ni leer ni escribir.
    - Guardar varios días es todo o nada: con un día pasado, no guarda ninguno.
  - Unitarias: el aviso con cada combinación y el destino del botón.
  - Navegador local: invitar y aceptar, ver el aviso, configurar y ver que se va. Cambiar el
    horario y ver 1 correo en el registro local.

#### F6 — Bajas seguras de cuentas (R-02, R-09, R-12, R-13, D23)

- **Suspender (R-09).** Aplicar `companies.status = 'suspended'` y un estado equivalente para
  autónomos (columna nueva, `DEFAULT` activo, Regla 2).
  - Sale del catálogo (`booking-authority`) y del directorio público.
  - Las funciones de presupuesto, pago y alargar rechazan las reservas **nuevas**.
  - Las reservas ya citadas se siguen haciendo, cobrando y valorando.
- **Herramienta «Eliminar o dar de baja» en Admin → Usuarios**, con una función de servidor solo
  para admin. Primero enseña qué va a pasar y por qué:
  - **Bloquea** si hay reservas futuras o en curso, pagos o reembolsos pendientes, o planes de
    mantenimiento activos. Las enseña, para completarlas, cancelarlas con reembolso o
    reasignarlas.
  - **Sin historial:** borra entera en una transacción, en orden: miembros, empresa,
    solicitudes, invitaciones y usuario (con `auth.admin.deleteUser`). Es lo mismo que el script
    probado con `jrodgom1204@…`.
  - **Con historial (D23):**
    - Veta el inicio de sesión (`ban`).
    - Suspende la empresa y pone inactivos a los miembros.
    - Anonimiza los datos personales: nombre, teléfono, correo en el perfil, dirección de la
      ficha y avatar.
    - Conserva reservas, importes y reseñas (estas, con autor anónimo).
  - Para un **empleado**: si tiene trabajos futuros, se niega hasta que se reasignan (F6 de
    empresas). Si no, pasa a inactivo y sigue lo mismo.
- **Que el panel de Supabase no pueda romper nada (R-12).**
  - Claves foráneas `RESTRICT` en `company_members.user_id`, `booking_blocks.assignee_id` y
    `company_applications.user_id` (en `SET NULL` para `reviewer_id`).
  - `bookings.client_id` y `bookings.gardener_id` pasan de `CASCADE` a `RESTRICT`.
  - Un borrado en bruto de una cuenta con historial falla (Postgres dice por qué) en vez de
    llevarse datos. Las cuentas sin historial se siguen pudiendo borrar desde el panel.
- **Limpieza de restos (R-13).** Se hace en la propia migración, antes de las claves: elimina las
  filas que apuntan a cuentas que no existen y lo apunta en el registro. En producción, esto
  incluye la solicitud huérfana `af612d76-…`, el miembro y la invitación de `c18d4ce4-…`.
- **Pruebas.**
  - Batería `verify-account-deletion.mjs`:
    - Sin historial: no queda ninguna fila.
    - Con historial: baja, anonimizada, sin poder entrar, reservas e importes intactos.
    - Con una reserva futura o un pago en curso: se niega y la nombra.
    - Un no-admin no puede usarla.
    - En bruto, un empleado con horas o un cliente con reservas pagadas: falla sin borrar.
    - Una empresa suspendida no aparece ni vende, y su reserva ya citada se completa y se cobra.
    - Un autónomo sin historial se sigue pudiendo borrar (Regla 2).
    - La consulta de restos da 0.
  - Unitarias: la pantalla de admin en sus tres casos.
  - Navegador local: el admin da de baja una empresa de prueba con una reserva pasada, y el
    dueño ya no puede entrar.

#### F7 — Notificaciones al móvil (R-08, D25)

- **Un solo punto de envío.** Cada vez que `send-email-notification` envía un correo, envía
  también la notificación al móvil a ese mismo usuario. Por ahí pasan todos los correos: los de
  la cola (F3), los del reloj (`booking-lifecycle-tick`), `booking-confirmation-email`, los
  pagos y la invitación. Así, «todo lo que llega por correo llega al móvil» sin tocar 25 sitios.
  El texto es el asunto del correo, una línea de resumen y el enlace a la pantalla. Si falla el
  envío al móvil, el correo sale igual.
- **Servidor.**
  - Tabla `push_subscriptions` (usuario, *endpoint*, claves, dispositivo, `created_at` y
    `last_used_at`), con RLS: solo las tuyas.
  - RPC para guardar y borrar la suscripción propia.
  - Claves VAPID como secretos de las funciones.
  - Envío con una librería de *web push* compatible con Deno. Si el servicio de push contesta
    404 o 410, borra la suscripción caducada.
- **Web.**
  - `public/sw.js`: un *service worker* **solo para push**. No guarda la web en caché, para no
    servir versiones viejas.
  - Recibe la notificación y, al tocarla, abre la URL.
  - Botón «Activar notificaciones» en «Mi cuenta» y una invitación tras la primera reserva o
    trabajo. El navegador exige que lo pulse el usuario.
  - En iPhone fuera de la app instalada, explica cómo añadir GarSer a la pantalla de inicio.
- **Pruebas.**
  - Unitarias: registro de la suscripción, estados del botón (no soportado, iPhone sin instalar,
    denegado o activo) y apertura de la URL.
  - Batería `verify-push.mjs`:
    - Cada correo manda 1 notificación a cada suscripción del destinatario y ninguna a otros.
    - 410 borra la suscripción.
    - Sin suscripción, solo sale el correo.
    - Un usuario no puede registrar suscripciones a nombre de otro.
  - Navegador local: activar las notificaciones en el navegador del panel, provocar una
    propuesta y ver llegar la notificación (el `service worker` funciona en `localhost`).

#### F8 — Despliegue a producción y pruebas en garser.es

- **Orden de despliegue** (lo hace el chat con permiso, como en la #40; la PR la fusiona el
  usuario):
  1. `send-email-notification`, en la versión que convive con la web vieja.
  2. `notification-dispatch`.
  3. Secretos: VAPID y el secreto de la cola en Vault.
  4. Migraciones.
  5. El resto de funciones que cambien (`booking-authority` por la suspensión, `booking-payment`
     si cambia).
  6. Web (PR).
- **Antes de la migración de F6,** consulta en producción de solo lectura: restos, claves que
  fallarían y reservas afectadas.
- **Pruebas en garser.es:** P-R01-1, P-R03-1, P-R04-1, P-R05-1, P-R06-1, P-R07-1, P-R02-1 y
  P-R08-1 (en Android y en iPhone instalada), apuntadas en `03-PRUEBAS.md`.

### 3.4 Qué se hizo en cada fase

#### F1 — hecho (2026-09-28)

**Código.**

- `AuthContext.tsx`:
  - `signOut` cierra **solo este dispositivo** (`scope: 'local'`). También el alta, la cuenta sin
    verificar y la invitación, que usan el mismo `signOut`.
  - Nuevo `signOutEverywhere`, con el botón «Cerrar todas» en «Mi cuenta → Seguridad».
  - `sessionEndedAt` cuando llega un `SIGNED_OUT` que no ha pedido esta pestaña.
  - `signIn` devuelve el tipo de cuenta.
  - Los `console.log` solo salen en desarrollo.
- `SessionEndedNotice.tsx` (nuevo, dentro del router): aviso «Tu sesión se ha cerrado (por
  ejemplo, desde otro dispositivo)…» y vuelta a `/auth` con la página de origen.
- `ProtectedRoute` pasa `redirectTo`: antes, tras volver a entrar siempre se iba a `/dashboard`.
- `AuthForm` usa `postLoginPath` (`src/utils/postLoginPath.ts`): el admin va a
  `/admin/dashboard`, la empresa a `/empresa` y el empleado a `/mi-trabajo`. Solo acepta rutas
  de vuelta internas.
- `AdminLayout`:
  - Cierra sesión con el mismo `signOut` que el resto de la web; antes llamaba al global y no
    limpiaba el almacenamiento.
  - Botón «Salir» en la barra del móvil (R-14).
- `ResetPassword`: tras cambiar la contraseña cierra las **demás** sesiones
  (`scope: 'others'`).
- `receivedAgo` (`src/utils/receivedAgo.ts`) sustituye a `getBookingStatus` en «Solicitudes».
- Borradores de propuesta en `sessionStorage` por usuario (`src/utils/sessionDrafts.ts`). El
  cierre normal los borra (`clearAuthStorage`).
- `useUnreadChats`: un canal por usuario compartido por las dos barras, que se suelta 2 s
  después del último, y ninguno para el admin ni mientras no se sabe el tipo de cuenta.

**Pruebas.**

- Unitarias nuevas: `postLoginPath`, `receivedAgo`, `sessionDrafts`, `useUnreadChats` (canal
  compartido) y `AuthContext` (local, global, cerrada desde fuera).
- Batería `verify-session-scope.mjs`, 3/3:
  - SS-01: cerrar en local deja viva la otra sesión.
  - SS-02: reproduce lo de producción; con el cierre global, la otra sesión recibe 403.
  - SS-03: `others` al cambiar la contraseña.
- **Navegador local** (`empresas-dev`, 305 px):
  - El admin entra y va directo a `/admin/dashboard`, sin aviso del WebSocket ni conexión de
    tiempo real.
  - «Salir» en el móvil lleva a `/auth` y deja el almacenamiento `sb-*` vacío.
  - Con una solicitud creada con `demo-pending-request.mjs`, «Solicitudes» dice «Hace 1 min».
  - Se escribe un borrador (70 € y un motivo), se borran en el servidor las sesiones del
    jardinero y se llama a `getUser`. Resultado: aviso de sesión cerrada, vuelta a `/auth` con
    `redirectTo`, y al volver a entrar, «Solicitudes» con el borrador intacto.
- Utilidad nueva para probar: `scripts/garser-empresas/demo-pending-request.mjs` (crea una
  solicitud pendiente del cliente al jardinero de la semilla, solo en local).

#### F2 — hecho (2026-09-28)

**Código.**

- `useRefreshOnReturn` (`src/hooks/useRefreshOnReturn.ts`): recarga al volver a la pestaña o a la
  app (`visibilitychange` y `pageshow` desde la caché), como mucho cada 30 s y sin solaparse.
- `RefreshButton` (`src/components/common/RefreshButton.tsx`): 44 px de alto, nombre accesible
  «Actualizar», gira mientras carga y no admite doble toque.
- Pantallas en las que están:
  - `BookingsList` (cliente), que recarga en silencio (`fetchBookings({ silent: true })`).
  - `GardenerBookings`: reservas y planes.
  - `BookingRequestsManager` («Solicitudes» del autónomo y de la empresa), que recarga en
    silencio y conserva los borradores.
  - `CompanyAgenda`: agenda más el aviso de solicitudes por aceptar, que ahora se puede volver a
    pedir (`loadPendingRequests`).
  - `EmployeeHomePage` («Mi trabajo»).
- Texto de «Solicitudes» sin trabajos: «aparecerán aquí» (antes decía «automáticamente», y no
  era verdad).
- R-15: `aria-label` en el botón de salir de la barra.

**Pruebas.**

- Unitarias: `useRefreshOnReturn` (vuelta, límite de 30 s, oculto o desactivado) y
  `RefreshButton` (llama, se desactiva, no hay doble toque).
- **Navegador local**, con dos sesiones a la vez: cliente en `127.0.0.1:5190` y jardinero en
  `localhost:5190`, que son orígenes distintos.
  - El jardinero acepta la solicitud; el cliente pulsa «Actualizar» y la ve «Confirmada» **sin
    recargar la web** (se conserva una marca puesta en `window`).
  - Se crea otra reserva por detrás, pasan más de 30 s y se lanza `visibilitychange`: aparece
    la reserva nueva sin pulsar nada. En el panel las pestañas de fondo siguen «visibles», así
    que el evento se lanza a mano.
  - La empresa (`demo-company.mjs`) entra directa a `/empresa`. Se crea otra solicitud por
    detrás y «Actualizar» cambia el aviso de «1 solicitud» a «2 solicitudes por aceptar».
  - La empleada entra directa a `/mi-trabajo`, con el botón en la cabecera. Capturas a 305 px.
- Utilidad nueva: `scripts/garser-empresas/demo-company.mjs` (empresa y empleada de prueba con
  una solicitud; `--clean` las borra; solo en local).

#### F3 — hecho (2026-09-28)

**Servidor** (migración `20260929100000_notification_outbox.sql`).

- **R-16:** fuera la regla «Participants can update bookings» y los permisos `UPDATE (status)` y
  `DELETE` de `authenticated` sobre `bookings`.
- `notification_outbox` (RLS sin reglas y sin permisos para usuarios) y
  `private.enqueue_notification` (idempotente por `dedupe_key`).
- Timbre:
  - `private.ring_notification_dispatch`: `pg_net` con el secreto del reloj y la URL deducida
    de `lifecycle_tick_url`, o de `notification_dispatch_url` si existe.
  - *Trigger* `AFTER INSERT` por sentencia.
  - Reloj `notification-outbox-dispatch` cada minuto, que solo llama si hay algo pendiente.
- `claim_notification_outbox` y `complete_notification_outbox` (solo `service_role`), con
  reintentos a 1, 5, 15 y 60 min y `failed` al quinto intento o si el fallo es un 4xx.
- *Triggers* que apuntan:
  - Precio: propuesta, aceptada, rechazada y **caducada (R-11)**.
  - Otra fecha: propuesta y respuesta.
  - Incidencia recibida.
  - Alta de jardinero y de empresa, aprobada o rechazada.
  - Sin `OF columna`, para que se vea la caducidad perezosa que pone un *trigger* `BEFORE`.
- `respond_booking_request`: envoltura sobre `private.respond_booking_request_core` (la de
  siempre, sin cambios), que apunta «aceptada» o «rechazada» solo si de verdad responde.

**Funciones.**

- `notification-dispatch` (nueva; `verify_jwt = false`, valida `x-lifecycle-secret` o la clave de
  servicio).
- `send-email-notification`:
  - `SERVER_MANAGED_TYPES`: las peticiones del navegador a esos tipos devuelven
    `skipped: server_managed` si la cola existe.
  - La caducidad va al jardinero, con un texto que le dice qué hacer.
  - R-17: el correo de propuesta rechazada dice que la solicitud queda cancelada.

**Web.** Fuera las 9 llamadas del navegador a esos correos:

- `bookingPriceChangeService` (tres), `bookingRescheduleService`, `bookingIncidentService` y
  `bookingRequestService` (dos).
- `RescheduleSection`, `ApplicationsAdmin` y `CompanyApplicationsAdmin`.
- El camino muerto de `GardenerDashboard` que escribía `bookings.status`.
- La invitación sigue en el navegador, ahora con un reintento.

**Pruebas.**

- Unitarias: `serverManagedEmails.test.ts` (proponer, responder, aceptar y cambiar de fecha no
  piden correos).
- Batería nueva `verify-notification-outbox.mjs`, 14/14:
  - NO-01: proponer con la **sesión revocada** (el caso de producción) apunta y envía el aviso.
  - NO-07: la web vieja recibe `server_managed`.
  - NO-11: tres pasadas a la vez envían el aviso una sola vez.
  - NO-12: R-16.
  - NO-06: R-11.
- `verify-f3-emails` y `verify-f6-reschedule` reescritas en sus comprobaciones de correo: nadie de
  fuera provoca el correo, y el servidor lo envía una vez al destinatario correcto. Las otras 18
  baterías siguen en verde sin cambios.
- **Navegador local:** el jardinero envía una propuesta desde «Solicitudes». El navegador no hace
  ninguna petición a `send-email-notification`; el aviso queda en la cola y sale 1 s después al
  correo del cliente (visto en el registro de la función en local, con el envío simulado).
- Configuración local para probarlo: `lifecycle_tick_url` (hacia
  `supabase_kong_GarSer-main_4:8000`) y `lifecycle_tick_secret` en el Vault local.

**Para producción (F8).**

1. Comprobar que el Vault tiene `lifecycle_tick_url` y `lifecycle_tick_secret` (los usa el reloj
   del ciclo de vida).
2. Desplegar `send-email-notification` antes que la migración, y después `notification-dispatch`.
3. Aplicar la migración.
4. Publicar la web.

## 4. Registro de avance

| Fase | Estado | Pruebas | Commit |
|---|---|---|---|
| F1 | ✅ Hecho (2026-09-28) | 573 pruebas (+15), `tsc` 128, compila; batería `verify-session-scope` 3/3; navegador local (abajo) | ver git |
| F2 | ✅ Hecho (2026-09-28) | 576 pruebas (+3), `tsc` 128, compila; navegador local (abajo) | ver git |
| F3 | ✅ Hecho (2026-09-28) | 579 pruebas (+3), `tsc` 128, compila; baterías 20/20 (244 comprobaciones, `verify-notification-outbox` 14/14 nueva; `verify-f3-emails` y `verify-f6-reschedule` adaptadas); navegador local | ver git |
| F4 | Pendiente | | |
| F5 | Pendiente | | |
| F6 | Pendiente | | |
| F7 | Pendiente | | |
| F8 | Pendiente | | |
