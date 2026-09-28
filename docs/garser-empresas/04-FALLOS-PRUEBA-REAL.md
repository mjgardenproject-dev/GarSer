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

Gravedad: **Crítica** (dinero, datos o seguridad) · **Alta** (un usuario no puede completar algo)
· **Media** (lo completa, pero mal o confuso) · **Baja** (cosmético, o solo se ve en la consola).

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

---

## 3. Plan de implementación

*(Se escribe cuando el usuario termine de reportar los fallos.)*
