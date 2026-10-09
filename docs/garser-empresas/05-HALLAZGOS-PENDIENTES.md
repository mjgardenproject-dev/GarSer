# Hallazgos y fallos aún no resueltos — GarSer (2026-09-29)

> Recoge **todo lo que sigue abierto** de `02-HALLAZGOS.md` (proyecto GarSer Empresas) y lo que
> se vio durante la prueba real y **no** era de la prueba en sí. Lo que falla o falta **en la
> prueba real en garser.es** está en `06-PRUEBA-REAL-PENDIENTE.md`.
>
> Cada punto se volvió a comprobar el 2026-09-29, contra el código de esta rama y el Supabase
> local, antes de escribirlo aquí. Las decisiones son del usuario, tomadas al crear este
> documento: van marcadas con **Decisión (usuario)**.
>
> Numeración propia: **PH-NN** (pendiente, hallazgo), con referencia al H- o R- de origen.

---

## 1. Índice

| # | Qué pasa | Gravedad | Origen | Decisión | Estado |
|---|---|---|---|---|---|
| PH-01 | «Mi cuenta»: cambiar la foto y «Cerrar cuenta» dicen «hecho» y no guardan nada | **Alta** (el usuario cree que ha cerrado su cuenta) | H-13 | Baja real con comprobaciones | ✅ Hecho (2026-10-09), por desplegar |
| PH-02 | Un jardinero rechazado no puede volver a solicitar: «volver a intentarlo» no hace nada | **Alta** (bloquea para siempre a un solicitante) | Sospecha de `02` §3, **verificada** | Reabrir al momento, con histórico | ✅ Hecho (2026-10-09), por desplegar |
| PH-03 | Al reservar con una empresa, el cliente lee «Jardinero» y «Confirmar jardinero» | Media (texto) | H-28 (punto 1) | «Profesional» para todos | ✅ Hecho (2026-10-09), por desplegar |
| PH-04 | Al dar de baja una cuenta, sus ficheros (fotos, carnet) se quedan guardados | Media (datos personales) | Visto en F6 | Borrarlos también | ✅ Hecho (2026-10-09), por desplegar |
| PH-05 | El navegador puede escribir las marcas de idempotencia de sus operaciones | **Media** (subida en la fase C: con una marca falsa se manda al cliente un «reserva aceptada» falso) | Visto en F3 | Cerrarlo | ✅ Hecho (2026-10-09), por desplegar |
| PH-06 | `ARCHITECTURE.md` describe un sistema que ya no existe | Media (despista) | H-07 | Reescribirlo | Por corregir |
| PH-07 | 9 pruebas de preparación de servicios fallan porque están desactualizadas | Media (se pierde una red de seguridad) | H-27 | Ponerlas al día | Por corregir |
| PH-08 | Al aceptar otra fecha con cambio de persona, a quien va le llegan dos correos | Baja | Visto en F4 | Técnica (ver punto) | ✅ Hecho (2026-10-09), por desplegar |
| PH-09 | El historial de migraciones del Supabase **local** está desalineado | Baja (solo entorno) | Visto en F3 | Técnica | Por corregir |
| PH-10 | `02-HALLAZGOS.md` tiene hallazgos resueltos todavía marcados como abiertos | Baja (documentación) | `01-PLAN` §5c.6 | — | Por corregir |
| PH-11 | `booking_items` no se actualiza tras un cambio de precio | Vigilado (sin efecto hoy) | H-36 | Sin acción (regla) | Vigilado |
| PH-12 | Las solicitudes a varios jardineros siguen desactivadas | Informativo | H-20 | Sin acción | Informativo |
| PH-13 | Tareas de cierre del proyecto (datos de prueba, Stripe real, encuesta) | Operativo | `01-PLAN` §5c | Encuesta: dada por buena | En parte |
| PH-14 | Storage: cualquiera con sesión lista y descarga fotos de reserva y de chat de otros; sin sesión se listan los ficheros de solicitud de todos | **Crítica** (datos personales, en producción) | Fase A, paso 3 | Corregir en la fase A (usuario, 2026-10-09) | ✅ Hecho (2026-10-09), por desplegar |
| PH-15 | Los correos de reserva no encuentran el nombre («Hola jardinero», «El profesional ha aceptado…») | Media (texto) | Fase A, paso 3 | Nombre de la ficha (usuario, 2026-10-09) | ✅ Hecho (2026-10-09), por desplegar |
| PH-16 | `booking-photos` es público en producción y privado en local; las imágenes del chat se enseñan con URL pública | Media (datos personales; el enlace es la única llave) | Fase A, paso 3 | — | Apuntado |
| PH-17 | En producción quedan 273 ficheros de solicitud (49 cuentas borradas) y 10 fotos de reserva o chat de cuentas que ya no existen | **Alta** (datos personales, públicos por enlace) | Fase A, paso 3 | Borrarlos en la fase H, con permiso | Apuntado (fase H) |
| PH-18 | El alta de jardinero se envía desde el navegador sin comprobar en el servidor que está completa (las empresas sí, con `submit_company_application`) | Baja (el admin revisa a mano) | Fase B, paso 3 | Lo deja al chat (usuario, 2026-10-09): servidor | ✅ Hecho (2026-10-09), por desplegar |

Gravedad: **Crítica** (dinero, datos o seguridad) · **Alta** (un usuario no puede completar algo o
se le engaña) · **Media** (lo completa, pero mal o confuso) · **Baja** (menor o solo interno).

---

## 2. Puntos

### PH-01 — «Mi cuenta»: la foto y «Cerrar cuenta» no guardan nada (H-13)

**Qué pasa.**

- «Cambiar foto» (`src/components/account/MyAccount.tsx:69`) y «Cerrar cuenta» (`:115`) hacen
  `.update(…).eq('id', user.id)`. Pero `profiles.id` **no** es el id del usuario: la clave es
  `user_id`.
- **Verificado el 2026-09-29:** en la base local, `select count(*) filter (where id = user_id)
  from profiles` da **0 de 8**. Las dos acciones no tocan ninguna fila y dicen «Foto
  actualizada» o «Cuenta cerrada».
- Con «Cerrar cuenta», el usuario cree que se ha ido y su cuenta sigue intacta, con sus datos y
  su acceso. Afecta a todos los tipos de cuenta.

**Decisión (usuario): baja real con comprobaciones.** El propio usuario se da de baja con la misma
lógica segura del admin (F6, D23):

- Si tiene reservas sin terminar, pagos o incidencias abiertas, o planes activos, se le dice
  cuáles, en su idioma: «Tienes 1 reserva confirmada el 3 de octubre: cancélala o espera a que
  termine».
- Sin historial, se borra entera.
- Con historial, se anonimiza, con veto de acceso y correo anónimo. Sus reservas e importes se
  conservan.
- Después se le saca de la sesión.

**Corrección propuesta.**

1. Función del servidor `self-account-closure` (o una acción más en `admin-account-closure`): el
   usuario solo puede actuar sobre sí mismo, y el admin no puede darse de baja desde aquí.
   Reutiliza `private.account_closure_plan` y `perform_account_closure`, que hoy exige un admin
   (se añade el caso «es la propia cuenta»).
2. En «Mi cuenta»:
   - Primero el análisis, con los motivos que bloquean.
   - Después la confirmación, explicando qué se borra y qué se conserva.
   - Al terminar, cierra la sesión en todos sus dispositivos.
3. «Cambiar foto»: arreglar la columna (`.eq('user_id', user.id)`) y comprobar que se ha
   actualizado de verdad (`select().single()`).
4. Buscar en toda la web otros `.eq('id', user.id)` sobre `profiles` y corregirlos.

**Pruebas.**

- Batería:
  - Cliente sin reservas: se borra.
  - Con una reserva pendiente: bloqueado, con el motivo.
  - Con historial: anonimizado y sin acceso.
  - Otro usuario no puede dar de baja a nadie más que a sí mismo.
- Unitaria: la foto se guarda.
- Navegador local: los tres casos desde «Mi cuenta».

#### Seguimiento (2026-10-09) — fase A, junto con PH-04

1. **Leído.** Las citas siguen en su sitio: `MyAccount.tsx:69` (foto) y `:115` («Cerrar
   cuenta») hacen `.eq('id', user.id)`. La carga del perfil (`:39`) ya busca por `id` o por
   `user_id`. Decisión: baja real con comprobaciones, hecha por el propio usuario.
2. **¿Es cierto?** Sí. Script con una cuenta desechable contra la base local
   (`repro-ph01.mjs`, en la carpeta de borradores):
   - La foto como la guarda la web: 200 con 0 filas y `avatar_url` sigue `NULL`.
   - «Cerrar cuenta» como la web: 200 con 0 filas, y nombre, teléfono y dirección intactos.
   - Después de «cerrar», la cuenta sigue entrando.
   - Con `user_id` sí se toca la fila.
   - De paso: el usuario **no** puede subirse el rol a admin, porque lo para un *trigger*
     («No tienes permisos para modificar el rol»).
3. **Casos parecidos.**
   - **El mismo `.eq('id', …)` sobre `profiles`:**
     - En la web solo estos dos. `ProfileSettings.tsx:697` y `EmployeeHomePage.tsx:83` ya usan
       `user_id`.
     - En las funciones: `_shared/bookingEmailDetails.ts:80` busca el nombre por `id`. Por eso
       los correos de reserva nunca llevan nombre. Pasa a **PH-15**.
     - En las reglas de Storage, las 4 de `marketing-assets` comparan `p.id = auth.uid()`: el
       admin nunca pasa (en local y en producción). Hoy no hay pantalla que suba ahí, pero la
       regla está mal: se corrige con `is_admin()`.
   - **Ficheros (PH-04):**
     - `applications` (público): `<user>/avatar`, `<user>/proof` y `<user>/certs`, que suben el
       alta y «Mi cuenta».
     - `private_licenses`: `<user>/…`, el carnet.
     - `booking-photos`: `drafts/<user>/…` (fotos de la reserva) y `chat/<reserva>/<user>/…`.
     - Hoy no se sube ningún logo ni foto de empresa.
   - **Permisos de Storage, con dos cuentas desechables (`repro-storage.mjs`):**
     - B lista y descarga la foto de borrador de A (200).
     - B lista las carpetas de borradores de todos.
     - Un anónimo lista los ficheros de solicitud de A.
     - El carnet sí está protegido: B recibe 400.
     - Pasa a **PH-14**.
   - **Producción, solo lectura, con permiso del usuario:**
     - Las mismas reglas.
     - Además, `booking-photos` es **público** allí (en local no): pasa a **PH-16**.
     - Quedan **273 de 281** ficheros de solicitud de **49 cuentas ya borradas**, y 10 de 11
       fotos de reserva o chat de 7 cuentas borradas: pasa a **PH-17**.
     - Solo hay 9 cuentas. Ningún dato personal se ha mostrado; solo recuentos.
     - Lo confirma también la batería local: tras borrar las cuentas de prueba, sus 3 ficheros
       siguen en Storage.
   - **Datos personales que la baja con historial deja hoy** (columnas de `public`):
     - Las coordenadas del cliente en `bookings`, `booking_quotes` y `maintenance_plans`. Se
       borra la dirección escrita, pero no el punto en el mapa.
     - `booking_requests.client_address` y `notes`.
     - Su correo real en `company_invitations` (si le invitaron), y los correos de los
       invitados pendientes de su empresa.
     - `push_subscriptions`.
     - Número y fichero del carnet en `gardener_licenses`.
     - Los chats se conservan por decisión (PR-05).
   - **Tipos de cuenta:** cliente, autónomo, dueño de empresa y empleado usan la misma «Mi
     cuenta». El admin no se da de baja desde aquí (lo bloquea `account_closure_plan`).
4. **Hallazgos nuevos.**
   - PH-14 y PH-15: preguntados, se corrigen en esta fase (respuesta del 2026-10-09).
   - PH-16 y PH-17: apuntados. PH-17 se limpia en la fase H, con permiso.
   - Las reglas de `marketing-assets` y los restos de datos personales del punto 3: claros y
     del mismo tema, se corrigen en esta fase.
5. **Comprobado (2026-10-09).**
   - **Qué se hizo:**
     - Migración `20261009100000_self_account_closure_and_storage.sql`: reglas de Storage, cola
       `account_storage_cleanup`, cuerpo común de la baja y `my_account_closure_preview`.
     - Función nueva `account-closure` y `_shared/accountClosure.ts`.
     - `admin-account-closure` borra los ficheros y `booking-lifecycle-tick` reintenta.
     - «Mi cuenta»: la foto se guarda por `user_id` y se comprueba; «Cerrar cuenta» primero
       revisa y después confirma.
     - Correos: nombres (PH-15) y escapado único (A-49).
     - El arnés de las baterías ya borra los ficheros de sus cuentas de prueba.
   - **Pruebas:**
     - Unitarias 930/113 (eran 921/111), build ✅ y `tsc` 128.
     - `verify-self-closure` 12/12 y todas las baterías **24, 280/280**.
     - Navegador local a 375 px con dos orígenes: bloqueada (con fecha y «Ver mis reservas»), con
       historial (aviso, diálogo, `/auth` con «Tu cuenta se ha cerrado», sin acceso y la reserva
       intacta en la base) y sin reservas (foto guardada y cuenta borrada).
     - En consola, solo dos 403 `user_not_found` del cierre de sesión de una cuenta que ya no
       existe.
   - **Pendiente en garser.es:** P-PH01-1, P-PH01-2, P-PH14-1 y P-PH15-1 (`06` §3, pasos 4.9 y 7.3).
   - **Commit:** `3e40929` (código) y el de la documentación.
   - **Vuelta atrás:** la de la cabecera de la migración (restaurar las reglas de Storage
     anteriores y `perform_account_closure` de `20260929130000`); las funciones, con la versión
     anterior de `main`.

### PH-02 — Un jardinero rechazado no puede volver a solicitar

**Qué pasa.**

- «Volver a intentarlo» (`src/components/gardener/GardenerStatusPage.tsx:31-45`) hace
  `update(status: 'draft')` sobre su solicitud rechazada y después `delete`.
- La regla `applications_own_update` solo deja actualizar filas **en `draft`**, y no hay regla de
  borrado.
- **Verificado el 2026-09-29 en local**, con un usuario y una solicitud rechazada: las dos
  llamadas responden **200 con 0 filas** y la solicitud sigue `rejected`. La web cree que lo ha
  conseguido y el jardinero vuelve a ver su rechazo, sin forma de volver a enviar nada.
- Es anterior a Empresas y afecta a los autónomos.

**Decisión (usuario): al momento, corrigiendo.** Se le abre un **borrador** con sus datos para corregir y
volver a enviar, y el rechazo queda en un histórico (como hacen las empresas).

**Corrección propuesta.**

- La tabla tiene `UNIQUE (user_id)` (`gardener_applications_user_id_key`, comprobado) y el alta
  hace `upsert` por `user_id` (`AuthContext.signIn`). Así que no se crea una fila nueva: se
  **reabre la misma solicitud como borrador**, con todos sus datos, y el rechazo anterior (fecha,
  motivo y quién lo revisó) se guarda en un histórico nuevo, `gardener_application_reviews`. El
  admin lo ve al revisarla otra vez.
- RPC `restart_gardener_application()` (`SECURITY DEFINER`, solo sobre la propia solicitud y
  solo si está `rejected`), que hace eso en una transacción.
- La web deja de hacer `update` y `delete` directos, llama a la RPC y comprueba el resultado.

**Pruebas.**

- Batería:
  - Rechazado → reintentar → borrador con sus datos → enviar → el admin lo ve pendiente.
  - Un jardinero pendiente o aprobado no puede reintentar.
  - Nadie puede reintentar la solicitud de otro.
- Navegador local, de principio a fin.

#### Seguimiento (2026-10-09) — fase B

1. **Leído.**
   - Las citas siguen ahí: `GardenerStatusPage.tsx:24-60` hace el `update` a `draft` y el
     `delete`.
   - Reglas vivas: `applications_own_update` solo deja tocar borradores y no hay regla de
     borrado.
   - Hay `UNIQUE (user_id)`.
   - `admin_review_gardener_application` solo revisa solicitudes `submitted`.
   - El aviso de rechazo lleva en su clave la fecha de la revisión, así que un segundo rechazo
     manda su correo.
   - El formulario (`GardenerApplicationWizard`) solo restauraba el progreso local, que se borra
     al enviar: una solicitud reabierta habría salido vacía.
   - Decisión: reabrir al momento, con histórico.
2. **¿Es cierto?** Sí (`repro-ph02.mjs`):
   - Las dos llamadas de la web responden 200 con 0 filas y la solicitud sigue `rejected`.
   - Crear otra choca con la clave única (409).
3. **Casos parecidos.**
   - **Permisos de la misma tabla:**
     - El solicitante **podía escribir** `reviewer_id`, `reviewed_at` y `review_comment` al
       enviar (comprobado: quedaban con sus valores).
     - No puede aprobarse: 0 filas.
   - **Las empresas** ya guardan cada rechazo como una fila y crean un borrador nuevo
     (`CompanyApplicationPage.tsx:67-80`). Para jardineros no se puede por la clave única: por
     eso se reabre la misma fila.
   - **Escrituras del navegador sin mirar las filas:** inventario de 27 `update`, `delete` y
     `upsert` en `src/`.
     - Fallan en silencio para su usuario legítimo solo estas: las de `gardener_applications` (el
       envío del formulario también decía «enviada» sin comprobar) y, ya arreglada en la fase A,
       la foto de «Mi cuenta».
     - Las demás (horarios, precios, ficha, chat, ajustes del admin) van con reglas «lo suyo» que
       sí coinciden con quien las usa. A los empleados se les bloquea a propósito, y no ven esas
       pantallas.
   - **Envío sin comprobar en el servidor** que el alta está completa: pasa a **PH-18**.
4. **Hallazgos nuevos.**
   - Los campos de revisión escribibles: claro y del mismo tema, corregido (trigger).
   - El envío que decía «enviada» sin guardar: corregido.
   - PH-18: apuntado.
5. **Comprobado.**
   - **Migración** `20261009110000_gardener_application_restart.sql`:
     - Tabla `gardener_application_reviews`, que leen el admin y el propio jardinero.
     - `restart_gardener_application()`: solo la propia, solo si está rechazada, y no duplica el
       histórico.
     - El trigger `trg_guard_gardener_application_review`.
   - **Web:**
     - `GardenerStatusPage` reabre por RPC y, si falla, lo dice.
     - El formulario se rellena con lo guardado y enseña el motivo.
     - El envío comprueba que se ha guardado.
     - El admin ve «Reenviada tras N rechazos» y «Rechazos anteriores».
   - **Pruebas:**
     - Unitarias 937/115 (7 nuevas), build ✅ y `tsc` 128.
     - `verify-gardener-reapply` 8/8 y **25 baterías, 288/288**.
     - Navegador local a 375 px con dos orígenes: el jardinero rechazado pulsa «Corregir y volver
       a enviar», el formulario sale relleno con el motivo del rechazo, vuelve a aceptar las
       declaraciones y envía («Solicitud en revisión»). El admin ve «Reenviada tras 1 rechazo» y
       «Rechazos anteriores» con el motivo, y la aprueba: se crea la ficha y salen de la cola
       los correos de rechazo y de alta.
     - Sin scroll lateral y sin peticiones fallidas en la página.
   - **Pendiente en garser.es:** P-PH02-1 (`06` §3, paso 2.7).
   - **Commit:** `4ef9d4c` y el de la documentación.
   - **Vuelta atrás:** la de la cabecera de la migración (borrar la función, el trigger y la
     tabla); la web anterior no usa nada de esto.

### PH-03 — «Jardinero» y «Confirmar jardinero» con empresas (H-28, punto 1)

**Qué pasa.** En la reserva, el resumen dice «Jardinero: Jardines Demo Costa» y el botón del
listado, «Confirmar jardinero» (`src/pages/reserva/ProvidersPage.tsx:1137` y el resumen de la
reserva). Con una empresa, el texto no es correcto.

**Decisión (usuario): «Profesional» para todos.** «Profesional» y «Confirmar profesional», tanto
para autónomos como para empresas.

**Corrección propuesta.**

- Buscar en el embudo de reserva y en el área de cliente los textos visibles con «jardinero»
  que se refieran al proveedor, y cambiarlos.
- No tocar el panel del propio jardinero ni el alta de jardineros, donde «jardinero» sí es
  correcto.
- Revisar también los correos al cliente.

**Pruebas.**

- Unitarias de los textos.
- Navegador local, reservando con un autónomo y con una empresa.

#### Seguimiento (2026-10-09) — fase D

1. **Leído.**
   - Las citas siguen ahí: `ProvidersPage.tsx:1137-1138` («Confirmar jardinero» y «Selecciona un
     jardinero») y el resumen de `ConfirmationPage.tsx:1829-1830`.
   - Decisión: «Profesional» para todos.
2. **¿Es cierto?** Sí, en el navegador local como cliente de la semilla: el primer paso decía
   «encontrar jardineros cerca de ti» y «para que el jardinero te encuentre».
3. **Casos parecidos.** Repasé con `grep` todos los textos visibles con «jardinero» fuera del
   panel y del alta del jardinero, y las plantillas de correo.
   - **Lo que lee el cliente, cambiado a «profesional»:**
     - Dirección (2 textos).
     - Detalles (4: la ayuda de las fotos, la altura de los árboles, el aviso del rango alto de
       palmeras y «Nota para el profesional»).
     - Profesionales (título por defecto, «No hay ningún profesional disponible…», «Confirmar
       profesional» y «Selecciona un profesional»).
     - Resumen (etiqueta, nombre por defecto y la etiqueta del botón de volver).
     - «Mis reservas» (nombre por defecto).
     - Lista de chats del cliente.
     - Perfil público (8 textos).
     - El aviso de palmeras del motor (`bookingQuoteCore.ts:1444`, y su instantánea de
       paridad): **hay que redesplegar `booking-authority`**.
     - El correo de solicitud no aceptada («Hay más profesionales disponibles en tu zona»).
     - El script de pruebas de punta a punta `scripts/qa/manual-entry/payment-local.mjs` pulsaba
       «Confirmar jardinero»: actualizado.
   - **No se tocan:**
     - Lo que ve el propio jardinero: su rol en el menú y en «Mi cuenta», su alta, su panel y
       los correos que recibe él.
     - La descripción que escribe cada profesional.
     - Las páginas públicas de captación y de búsqueda («Jardineros en la Costa del Sol»,
       «Portal para jardineros», «¿Eres jardinero?»): no están en el alcance de PH-03 y son las
       palabras con las que se busca en Google.
4. **Hallazgos nuevos.**
   - **El perfil público enseñaba identificadores internos** en «Servicios que ofrece».
     `gardener_profiles.services` mezcla nombres (los guarda el alta) e identificadores (los
     guarda la configuración de precios, `ProfileSettings.tsx:329`).
     - Claro y de la misma pantalla: corregido (`src/utils/serviceLabels.ts`).
     - En producción pasa con todo profesional que haya activado un servicio.
5. **Comprobado.**
   - **Unitarias:** 951 en 117 ficheros, build ✅ y `tsc` 128.
     - `clientWording.test.ts`: vigila que no vuelva «jardinero» a los textos del cliente.
     - `serviceLabels.test.ts`.
   - **Baterías:** 26, 294/294.
   - **Navegador local a 375 px**, como cliente de la semilla, reserva de césped con datos a mano:
     - Dirección y detalles dicen «profesional».
     - Con el **autónomo** de la semilla: «Confirmar profesional» y, en el resumen,
       «Profesional: Miguel Ángel Ruiz».
     - Con una **empresa** de prueba: «Profesional: demo-empresa…».
     - En «Mis reservas» no queda ningún «jardinero».
     - El perfil público dice «Perfil público del profesional» y «Reservar con este
       profesional», y lista los 7 servicios por su nombre.
     - Sin scroll lateral.
   - **Pendiente en garser.es:** P-PH03-1.
   - **Commits:** `569c8d1` y `1bf4b7e`.
   - **Vuelta atrás:** la versión anterior de la web y de las funciones.

### PH-04 — Los ficheros de una cuenta dada de baja se quedan guardados

**Qué pasa.**

- `perform_account_closure` (F6) borra de la base de datos los datos personales de una cuenta
  con historial. Pero sus **ficheros en Storage** siguen guardados:
  - Foto de perfil y foto profesional.
  - Fotos de la solicitud (`proof_photos`, `certification_photos`).
  - Carnet fitosanitario.
  - Logo de la empresa.
  - Fotos de reservas que aún no se hayan limpiado.
- Con una cuenta sin historial pasa lo mismo: se borran las filas, no los ficheros.

**Decisión (usuario): borrarlos también.**

**Corrección propuesta.**

- En `admin-account-closure`, y en el cierre por el propio usuario de PH-01, después de la base
  de datos se borran los ficheros de la cuenta en cada *bucket*: por su ruta (`<user_id>/…`) y
  por las URL que la base tenía guardadas.
- Se reutiliza `_shared/bookingMediaCleanup.ts`, que ya borra las fotos al cerrar reservas.
- Si el borrado de un fichero falla, se apunta y se reintenta; nunca deshace la baja.

**Pruebas.** Batería: una cuenta con foto, carnet y fotos de solicitud; tras la baja no queda
ningún fichero suyo en Storage.

### PH-05 — El navegador puede escribir sus propias marcas de idempotencia

**Qué pasa.**

- La tabla `booking_rpc_idempotency` guarda que una operación, por ejemplo «responder a esta
  solicitud», ya se hizo, para no repetirla.
- `authenticated` tiene permisos de escritura y hay reglas «Users can insert/update own booking
  idempotency records».
- Un usuario podría crear de antemano la marca de una operación **suya**. Esa operación
  devolvería la respuesta que él hubiera escrito sin ejecutarse de verdad.
- No afecta a otros usuarios ni mueve dinero. Las funciones que la usan son `SECURITY DEFINER` y
  no necesitan esos permisos.

**Decisión (usuario): cerrarlo.**

**Corrección propuesta.**

- Migración:
  - `REVOKE INSERT, UPDATE, DELETE ON booking_rpc_idempotency FROM authenticated`.
  - Quitar las dos reglas de escritura.
- Revisar que ninguna función `SECURITY INVOKER` escriba en ella.

**Pruebas.**

- Batería:
  - Un usuario no puede insertar una marca.
  - Aceptar una solicitud dos veces con la misma operación sigue devolviendo lo mismo.
  - Las 23 baterías, en verde.

#### Seguimiento (2026-10-09) — fase C

1. **Leído.**
   - **Permisos vivos:** `authenticated` tiene INSERT, UPDATE y DELETE sobre
     `booking_rpc_idempotency`, con reglas de insertar y actualizar las suyas.
   - **Los ayudantes** `register_booking_operation_once` y `complete_booking_operation` son
     `SECURITY INVOKER` y tienen EXECUTE para PUBLIC.
   - **Sus gemelos de lotes** ya no tenían permisos.
   - **Quién usa las marcas:** `respond_booking_request_core`, `create_atomic_booking`,
     `create_broadcast_booking_requests` (desactivada, PH-12), `propose_booking_price_change` y
     `respond_booking_price_change`, todas `SECURITY DEFINER`. Ni la web ni las funciones las
     escriben.
   - Decisión: cerrarlo.
2. **¿Es cierto?** Sí, y **peor de lo apuntado** (`repro-ph05.mjs`):
   - El proveedor escribe la marca de «aceptar» con una respuesta inventada (201).
   - Al llamar a `respond_booking_request` con esa operación recibe «confirmed» sin que se ejecute
     nada: la reserva sigue `pending`.
   - Además, la envoltura de F3 apunta `booking_accepted`, porque mira la respuesta y no la
     reserva. **El cliente recibiría «Tu reserva ha sido aceptada» siendo falso.** El verdadero
     ya no saldría después, porque usa la misma clave contra duplicados.
   - Los ayudantes también se podían llamar desde el navegador.
   - **Gravedad subida a Media.**
3. **Casos parecidos.**
   - Inventario de las 27 tablas a las que `authenticated` puede escribir, con sus reglas.
   - Del mismo tipo (marcas técnicas que el servidor da por buenas) solo hay esta y la de lotes,
     que ya estaba cerrada.
   - Las de registro (`booking_manual_declarations`, `booking_variable_revisions`, `role_logs`)
     guardan lo que escribe el propio usuario y no se usan como prueba de nada hecho por el
     servidor.
   - Las de solicitudes a varios (`booking_requests`, `booking_responses`) son del camino
     desactivado (PH-12).
4. **Hallazgos nuevos.** El aviso falso al cliente: mismo tema, corregido; la envoltura ahora mira
   el estado real.
5. **Comprobado.**
   - **Migración** `20261009120000_close_booking_idempotency_writes.sql`: sin escritura desde el
     navegador (también se quitan las reglas inertes de lotes), ayudantes solo del servidor y
     aviso según el estado real.
   - **Batería** `verify-idempotency-notices`, 5/5:
     - Marca, lotes y ayudantes dan 403.
     - Aceptar dos veces con la misma operación confirma una vez, con 1 solo correo, y la
       empresa sigue leyendo su marca.
     - Proponer y rechazar un precio repetidos siguen funcionando.
     - Un autónomo acepta igual (Regla 2).
   - **Todas las baterías:** 26, 293/293. Unitarias 937/115, build ✅ y `tsc` 128.
   - **El mismo script de antes:** ahora la marca da 403 y la aceptación real funciona.
   - **Navegador local:** el jardinero autónomo de la semilla acepta una solicitud desde
     «Solicitudes»; la reserva queda confirmada, la marca la escribe el servidor, sale el correo y
     no hay errores de permisos en la consola.
   - **Pendiente en garser.es:** P-PH05-1.
   - **Commit:** `530c301`.
   - **Vuelta atrás:** la de la cabecera de la migración.

### PH-06 — `ARCHITECTURE.md` está desactualizado (H-07)

**Qué pasa.**

- El documento de la raíz es de abril de 2026. Dice que `availability_blocks` «no existe» (sí
  existe) y que hay «5 motores de precios» sueltos (están unidos en
  `src/domain/pricingEngine.ts`).
- No cuenta nada de empresas, de la cola de avisos, de las bajas ni de las notificaciones al
  móvil.

**Decisión (usuario): reescribirlo.**

**Corrección propuesta.** Un documento corto y actual:

- Piezas: web, Supabase, funciones y Stripe.
- El recorrido de una reserva: presupuesto, pago, agenda, aceptación y cierre.
- Proveedores (autónomos y empresas) y cómo se reparte la agenda.
- Avisos: cola, correo y móvil.
- Seguridad: qué escribe el navegador y qué solo el servidor.
- Despliegue y operaciones: qué función redesplegar al tocar qué.
- Cada afirmación, con su fichero.

### PH-07 — 9 pruebas de preparación de servicios desactualizadas (H-27)

**Qué pasa.** Las baterías de `scripts/readiness/` fallan en 9 pruebas (césped 2, arbustos 2,
palmeras 2, desbroce 1 y fitosanitarios 2), iguales que antes de Empresas. Son **las pruebas las
que están desactualizadas**, no la web:

- Esperan un código de aviso (`lawn_area_implausible`…) donde hoy sale el texto.
- El jardinero de la semilla no tiene un carnet válido.
- La semilla no tiene horas libres los días que eligen.

**Decisión (usuario): ponerlas al día.**

**Corrección propuesta.**

- Ajustar cada prueba al contrato actual (códigos o textos) sin rebajar lo que comprueba.
- Dar a la semilla un carnet válido y un horario, o elegir días con horas libres.
- Confirmar las 7 baterías en verde.

### PH-08 — Dos correos al trabajador al aceptar otra fecha con cambio de persona

**Qué pasa.**

- Si al aceptar una fecha nueva cambia quién va (por ejemplo, de Ana a Luis), a Luis le llegan
  dos correos: «La reserva se ha movido» (`booking_reschedule_answered`, que avisa a quien va) y
  «Nuevo trabajo» (`job_assigned`, F4).
- Visto en `verify-f6-reschedule`, F6-35, con dos envíos.
- Los dos dicen cosas ciertas, pero es repetitivo.

**Decisión técnica** (reversible, §5 de la guía): **quien entra recibe solo «Nuevo trabajo»**,
porque ya incluye la fecha y la hora nuevas. `booking_reschedule_answered` avisa a la empresa y
a quien ya iba y sigue yendo. Se anota en `02-HALLAZGOS.md` al hacerlo.

**Pruebas.** `verify-f6-reschedule`: al aceptar con cambio de persona, a Luis 1 correo
(«Nuevo trabajo»), a la empresa 1, y a Ana «Ya no vas».

#### Seguimiento (2026-10-09) — fase C

1. **Leído.**
   - `send-email-notification`, rama `booking_reschedule_answered`: avisaba a todos los
     asignados del trabajo.
   - `private.sync_job_notices` (diferido, F4) apunta `job_assigned` a quien entra, en la misma
     transacción que la aceptación.
   - Decisión técnica (reversible): quien entra recibe solo «Nuevo trabajo».
2. **¿Es cierto?** Sí. `verify-f6-reschedule` con la función anterior: a Luis, que entra, le
   llegan «Nuevo trabajo» **y** «Tu trabajo cambia de fecha» (`luisMoved: 1`).
3. **Casos parecidos.**
   - Cuando sigue la misma persona, tiene que seguir recibiendo «Tu trabajo cambia de fecha» y
     ningún «Nuevo trabajo» de más.
   - En los cambios de quién va sin cambiar de fecha («cambiar quién va», F5) solo salen
     `job_assigned` y `job_unassigned`: no hay solape.
   - Una propuesta de precio aceptada no manda avisos de equipo, salvo `job_assigned` si se
     confirma; no hay solape.
4. **Hallazgos nuevos.**
   - Las baterías con `docker logs --since` fallan si el Mac duerme: `verify-f6-reschedule` y la
     nueva ya buscan por el correo de cada cuenta, en todo el registro.
5. **Comprobado.**
   - **El cambio:** `send-email-notification` excluye a quien tiene un `job_assigned` apuntado en
     la misma transacción que la aceptación (misma hora en `notification_outbox`).
   - **`verify-f6-reschedule`:** F6-35 reescrita para contar los correos de cada persona: empresa
     1, Luis 1 («Nuevo trabajo») y Ana 1 («Ya no vas»); 9/9.
   - **IC-04, quien sigue:** a Ana 1 «Tu trabajo cambia de fecha».
   - **Pendiente en garser.es:** P-PH08-1 (`06`, paso 4.7). **Hay que redesplegar
     `send-email-notification`.**
   - **Commit:** `530c301`.
   - **Vuelta atrás:** la versión anterior de la función.

### PH-09 — Historial de migraciones local desalineado

**Qué pasa.**

- En el Supabase local, `supabase migration up` se niega: dice que hay migraciones «por
  insertar antes de la última». Las de F3 a F9 (`20260924160000`…`20260926150000`) están
  aplicadas pero **no registradas** en `supabase_migrations.schema_migrations` local.
- Las de esta tanda se aplicaron con `psql`.
- En producción el historial está bien (139 migraciones, `db push` sin problemas).

**Decisión técnica:** registrar en local las versiones que faltan (`insert … on conflict do
nothing`), sin volver a ejecutarlas. Así `migration up` vuelve a funcionar para la próxima
migración. Solo afecta al entorno local.

### PH-10 — Documentación con hallazgos resueltos todavía abiertos

**Qué pasa.** `02-HALLAZGOS.md` aún marca como abiertos cosas ya resueltas:

- H-02: el tope de 12 h lo resolvió F7 separando jornada y mano de obra.
- H-03 y H-17: `resize_booking_schedule`, en F1.
- H-06: el rol, en F0.
- H-11, H-21 y H-22 dicen «pendiente en producción hasta la fusión», y ya están fusionados.
- En §3 («Sospechas sin verificar») hay cosas ya comprobadas:
  - Los solapes de `booking_blocks`: la migración de F1 entró en producción.
  - «Hace 1 hora»: resuelto en R-06d.
  - «Volver a intentarlo»: verificado, ahora es PH-02.
  - El texto de «Rol seleccionado» en la invitación: ya no aplica, porque desde D21 la
    invitación tiene su propio alta.

**Corrección:** actualizar esos estados, cerrar el estado global en `01-PLAN-Y-PROGRESO.md` y
añadir la fila final del registro.

### PH-11 — `booking_items` no se actualiza tras un cambio de precio (H-36) · vigilado

- La foto del presupuesto pagado no cambia cuando se acepta un nuevo precio o una nueva
  duración. La fuente de verdad es `bookings`.
- **Hoy no se ve en ningún sitio.**
- **Regla:** no sumar importes ni horas de `booking_items` para enseñar el total. Si algún día se
  enseña el desglose por servicio, hay que decidir cómo repartir la diferencia.
- Sin acción.

### PH-12 — Solicitudes a varios jardineros desactivadas (H-20) · informativo

- `create_broadcast_booking_requests` no la puede llamar nadie desde mayo.
- Queda sin comprobar cómo respondería una empresa, pero no se puede llegar a ese camino.
- Si algún día se reactiva, hay que revisarla con empresas antes (sospecha de `02` §3).

### PH-13 — Tareas de cierre del proyecto (`01-PLAN-Y-PROGRESO.md` §5c)

| Tarea | Estado |
|---|---|
| **D7, encuesta de alta de empresas** | **Decisión (usuario, 2026-09-29): se da por buena tal como está.** Se cierra D7 en el plan. |
| Limpiar los datos de prueba de producción (reservas y cuentas de prueba) | Pendiente, al terminar las pruebas en garser.es (ver `06`). Se hará con la herramienta de bajas de F6. |
| **Stripe en claves reales** (`pk_live`, secreto del webhook de modo real) y repetir un pago real | Pendiente, **antes de tener clientes reales**. Lo hace el usuario en el panel de Stripe y en los secretos. |
| Revisar los 128 errores de `tsc` (anteriores al proyecto) | Fuera de alcance. No son señal de regresión (H-10). |

### PH-14 — Storage deja ver ficheros de otros (fase A, paso 3) · seguridad

- `booking_photos_select_auth` deja **leer y listar todo** `booking-photos` a cualquier usuario
  con sesión: fotos de los jardines (`drafts/<user>/…`) e imágenes de chat
  (`chat/<reserva>/<user>/…`).
- `Public Read Applications` deja **listar sin sesión** todo `applications`: fotos de perfil, de
  prueba de trabajos y certificados de cada solicitante.
- Comprobado en local con dos cuentas desechables y, en producción, leyendo las reglas: son las
  mismas.
- **Decisión (usuario, 2026-10-09): corregirlo en la fase A.** Cada fichero lo ven solo:
  - su dueño;
  - quien comparte esa reserva (cliente, proveedor y quien va);
  - el admin.
  Los enlaces públicos que ya existen (fotos de perfil y de la solicitud) siguen funcionando,
  porque el depósito sigue siendo público. Lo que se cierra es poder listarlo todo.

### PH-15 — Los correos de reserva no llevan nombres (fase A, paso 3)

- `resolveRecipient` (`_shared/bookingEmailDetails.ts:80`) busca `profiles` por `id`. Como
  nunca coincide, el nombre sale vacío y los correos dicen «¡Gracias, cliente!», «Hola
  jardinero» y «El profesional ha aceptado tu reserva».
- **Decisión (usuario, 2026-10-09): el nombre de la ficha.**
  - El cliente, por su nombre (`profiles.full_name`).
  - El profesional, por el de su ficha (`gardener_profiles.full_name`): para una empresa, su
    nombre comercial, no el del dueño (H-31).
- Toca `send-email-notification` y `booking-confirmation-email`: **hay que redesplegarlas**.

### PH-16 — `booking-photos` público en producción (fase A, paso 3)

- En producción `storage.buckets.public = true` para `booking-photos`; en local es `false`. Lo
  hizo alguien a mano, porque ninguna migración lo cambia.
- El chat enseña sus imágenes con `getPublicUrl` (`src/utils/chatService.ts:104`), así que
  depende de que sea público. En local las imágenes del chat no se ven.
- Con PH-14 ya nadie puede listar, pero quien tenga el enlace de una foto la ve sin sesión.
- **Propuesta:** pasar el chat a enlaces firmados (como las fotos de reserva,
  `bookingPhotoPipeline.ts:102`) y volver a hacer privado el depósito. Es un cambio aparte,
  **pendiente de decisión**.

### PH-17 — Ficheros de cuentas ya borradas en producción (fase A, paso 3)

- Recuento del 2026-10-09, solo lectura:
  - `applications`: 273 de 281 ficheros son de 49 cuentas que ya no existen.
  - `booking-photos`: 10 de 11, de 7 cuentas.
  - `private_licenses`: 2 marcadores vacíos de cuentas borradas.
- Son de las bajas hechas desde el panel de Supabase antes de F6, y están en depósitos
  públicos.
- **Propuesta:** en la fase H, tras la copia de seguridad, borrarlos con un script que solo toque
  carpetas cuyo usuario no exista. **Es un borrado permanente: se pide permiso antes.**

### PH-18 — El alta de jardinero no se valida en el servidor (fase B, paso 3)

- El formulario envía la solicitud con un `update` a `submitted` desde el navegador. Las reglas
  dejan enviar un borrador aunque le falten datos (el formulario los exige, pero se puede saltar
  con una llamada directa).
- Las empresas usan `submit_company_application`, que comprueba en el servidor lo obligatorio.
- Impacto bajo: el admin revisa cada solicitud a mano.
- **Propuesta:** `submit_gardener_application()` con las mismas comprobaciones que el formulario
  (nombre, teléfono, zona, foto, servicios, herramientas, experiencia y declaraciones), y quitar
  `submitted` de lo que el navegador puede escribir. **Pendiente de decisión.**

#### Seguimiento (2026-10-09) — con la fase D

1. **Leído.**
   - El formulario enviaba con un `update` a `submitted`, y la regla `applications_own_update`
     lo permitía con cualquier borrador.
   - Las empresas usan `submit_company_application`.
   - Decisión: el usuario lo dejó al chat («realiza las acciones que veas convenientes»). Se
     aplica la propuesta.
2. **¿Es cierto?** Sí: en la fase B, GR-09 enviaba a mano un borrador incompleto.
3. **Casos parecidos.**
   - El alta de empresas ya valida en el servidor.
   - La invitación de empleados entra por su propia función.
   - Ningún otro paso de alta se envía desde el navegador.
4. **Hallazgos nuevos:** ninguno.
5. **Comprobado.**
   - **Migración** `20261009130000_submit_gardener_application.sql`:
     - `submit_gardener_application()` comprueba lo mismo que el formulario (nombre, teléfono
       español, zona, foto, servicios, herramientas, experiencia y las dos declaraciones) y no
       da error si se repite.
     - La regla deja al navegador solo editar su borrador.
   - **Web:** el formulario envía por la función y enseña lo que falta.
   - **`verify-gardener-reapply` 9/9.** GR-09:
     - A mano: 0 filas.
     - Incompleta: «Falta: un teléfono válido, zona de trabajo, foto de perfil, servicios,
       herramientas, experiencia, aceptar las dos declaraciones».
     - Completa: se envía.
     - Las demás comprobaciones de la batería envían ya por la función.
   - **Navegador local:** un jardinero con el borrador completo abre `/apply` (relleno desde la
     base), marca las casillas y envía: «Solicitud en revisión», y en la base queda `submitted`
     con su correo.
   - **Commit:** `569c8d1`.
   - **Vuelta atrás:** la de la cabecera de la migración.

---

## 3. Orden propuesto para corregirlos

Por gravedad y dependencias. Cada punto se cierra como en el plan de `04` §3: pruebas, baterías,
navegador local, documento y commit.

1. **PH-01** (baja real desde «Mi cuenta») y **PH-04** (ficheros): comparten la función de baja.
2. **PH-02** (reintentar la solicitud de jardinero).
3. **PH-05** (idempotencia) y **PH-08** (correo doble): pequeños, en la misma migración o
   función.
4. **PH-03** (textos «Profesional»).
5. **PH-07** (pruebas de preparación), **PH-09** (entorno local) y **PH-06** (arquitectura).
6. **PH-10** (documentos), al final.

Lo que toca a producción (PH-01, PH-02, PH-04, PH-05 y PH-08) se despliega junto, con permiso,
como en F8.
