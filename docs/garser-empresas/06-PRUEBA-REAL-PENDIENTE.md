# Prueba real en garser.es: lo que queda pendiente (2026-09-29)

> Todo lo que **aún no está resuelto o comprobado** de la prueba real del usuario en garser.es
> (`04-FALLOS-PRUEBA-REAL.md`, R-01…R-20) y de las pruebas de producción sin hacer
> (`03-PRUEBAS.md` §3). Los hallazgos que no son de la prueba real están en
> `05-HALLAZGOS-PENDIENTES.md`.
>
> Decisiones del usuario tomadas al crear este documento, marcadas con **Decisión (usuario)**.
> Numeración propia: **PR-NN**.

---

## 1. Índice

| # | Qué falta | Gravedad | Origen | Decisión | Estado |
|---|---|---|---|---|---|
| PR-01 | La web de la corrección (PR #41) no estaba publicada | — | F8 | — | ✅ Resuelto: el usuario fusionó la #41 el 2026-09-29 |
| PR-02 | Un proveedor suspendido no ve en su panel que lo está | Media | R-20 | Aviso en el panel y correo | Por corregir |
| PR-03 | Las notificaciones al móvil no se han visto llegar a un móvil de verdad | Media (solo comprobable en garser.es) | F7 (R-08) | — | Pendiente de prueba |
| PR-04 | 41 pruebas en garser.es sin hacer, varias duplicadas u obsoletas | Media | `03-PRUEBAS.md` §3 | Una guía única, ordenada | Guía en §3 |
| PR-05 | Al dar de baja una cuenta, sus mensajes de chat se conservan | Decisión tomada | Visto en F6 | Conservarlos | Cerrado (sin cambios) |

Los malos diagnósticos de la prueba real (R-01a, errores de una extensión de Chrome, y R-02, el
freno a propósito de Supabase) no tienen nada pendiente. Los fallos reales que salieron de ellos
están corregidos (`04` §1b).

---

## 2. Puntos

### PR-01 — Publicar la web (PR #41)

**Estado a 2026-09-29.**

- El **servidor está en producción desde F8**: 5 migraciones, 5 funciones y los secretos VAPID.
- La **web sigue siendo la anterior** hasta fusionar la PR
  [#41](https://github.com/mjgardenproject-dev/GarSer/pull/41).

**Qué pasa mientras tanto.** Está previsto y comprobado en F8:

- Los correos ya los envía el servidor. Las peticiones de la web anterior se ignoran
  (`server_managed`), así que no hay duplicados.
- El agujero R-16 ya está cerrado.
- Lo que no se ve hasta publicar:
  - El cierre de sesión solo local.
  - El botón «Actualizar».
  - El aviso de empleados por configurar.
  - «Mi trabajo» sin trabajos pendientes. El servidor ya no los devuelve.
  - La pantalla de bajas del admin.
  - La tarjeta de notificaciones.
- Detalle: con la web anterior, el dueño guarda los días sueltos de un empleado día a día, así
  que el empleado **no** recibe el correo de horario publicado hasta publicar la web nueva.

**Acción del usuario:** fusionar la PR #41 con «Squash and merge».

### PR-02 — El proveedor suspendido no sabe que lo está (R-20)

**Qué pasa.** Suspender (F6) corta las reservas nuevas, pero el profesional o la empresa no ve
ningún aviso en su panel. Solo nota que no le llega nada.

**Decisión (usuario): aviso en el panel y correo.**

**Corrección propuesta.**

- Aviso fijo en el panel del autónomo (`GardenerDashboard`) y de la empresa (`/empresa`): «Tu
  cuenta está suspendida: no recibes reservas nuevas. Tus reservas ya citadas siguen su curso.
  Si crees que es un error, escríbenos».
- El estado se lee de `gardener_profiles.suspended_at`, con permiso de lectura sobre la propia
  ficha.
- Correo al suspender y al reactivar (`provider_suspended` y `provider_reactivated`), apuntado en
  la cola de F3 desde `admin_set_provider_suspended`. Con F7, también al móvil.

**Pruebas.**

- Batería: suspender apunta 1 aviso y reactivar, otro; repetir no duplica.
- Unitaria: el aviso del panel con `suspended_at`.
- Navegador local, en los dos paneles.

### PR-03 — Notificaciones al móvil en un móvil real (R-08)

- En local se comprobaron el cifrado, la firma y el camino completo hasta el servicio de push
  de Google (`04` §3.4, F7).
- **Falta verlas llegar** a un Android y a un iPhone. Es la prueba P-R08-1, sesión 6 de la guía.
- Requisitos del iPhone: iOS 16.4 o posterior, y GarSer añadida a la pantalla de inicio y
  abierta desde ese icono.

### PR-04 — Las pruebas de producción, en una guía única

**Decisión (usuario): una guía única, ordenada.**

- Se quitan las duplicadas y las obsoletas, y se agrupan por sesión según las cuentas que hacen
  falta.
- En cada paso, el usuario hace la acción en su móvil u ordenador, y el chat comprueba la base
  de datos de producción (solo lectura) y los avisos enviados.
- Los inicios de sesión los pide el chat con una pregunta, como siempre.

Pruebas que **se fusionan o dejan de aplicar**:

| Prueba | Qué pasa con ella |
|---|---|
| P-F3-6 (invitación con confirmación del correo) | **Obsoleta desde D21**: el empleado crea su cuenta dentro de la invitación, sin confirmar el correo aparte. Se sustituye por P-D21-1. |
| P-F3-9 (llega el correo de invitación) | Se une a P-D21-1: es su primer paso. |
| P-F5-2 y P-D22-1 (el dueño pone el horario) | Se unen a P-R05-1, que además comprueba el correo al empleado. |
| P-F3-10 y P-F3-11 (correos de alta y rechazo de empresa) | Se unen a P-F3-4 y P-F3-5. |
| P-R04-1 (aviso y correo al unirse alguien) | Se une a P-D21-1 (misma invitación). |
| P-F5-3 (cambiar quién va: dos correos) | Se une a la sesión 4, con P-R07-1. |
| P-H44-1 (inicio y fin tras cambiar la fecha) | Se une a P-F6-2 y P-H42-1 (mover de fecha). |

---

## 3. Guía de pruebas en garser.es (orden de ejecución)

**Antes de empezar:**

- La PR #41 está fusionada (PR-01).
- Se usa **Stripe en modo prueba** con la tarjeta de pruebas, que teclea el usuario.
- Hacen falta estas cuentas:
  - El admin.
  - Un cliente de prueba.
  - Correos nuevos, que crea el usuario: un cliente, un jardinero, dos empresas (una para
    aprobar y otra para rechazar) y dos empleados (uno nuevo y uno que ya sea cliente).
- Marcar en `03-PRUEBAS.md` cada prueba superada.

### Sesión 1 — Admin y acceso (solo el admin)

| Paso | Prueba | Qué se hace | Qué debe pasar |
|---|---|---|---|
| 1.1 | P-R01-1 | Entrar como admin en una ventana de incógnito sin extensiones | Va directo a su panel y la consola no muestra el aviso del WebSocket |
| 1.2 | P-R06-2 | Con el admin abierto también en otro dispositivo: «Mi cuenta → Cerrar todas» | El otro dispositivo, al usarlo, avisa «Tu sesión se ha cerrado…» |

### Sesión 2 — Registros y altas

| Paso | Prueba | Qué se hace | Qué debe pasar |
|---|---|---|---|
| 2.1 | P-F0-1 | Registrarse como cliente con un correo nuevo | Tiene perfil de cliente (lo mira el chat) |
| 2.2 | P-F0-2 → P-F2-3 | Registrarse como jardinero, enviar la solicitud; el admin la aprueba | Perfil de jardinero; tras aprobar, su ficha y sus precios; le llega el correo de alta |
| 2.3 | P-F3-1 | Ese jardinero sube un carnet | Queda pendiente y el admin lo ve |
| 2.4 | P-H38-1 | Ese jardinero pone 0,5 €/m² en césped y guarda | En la base de datos, `0.5` |
| 2.5 | P-F3-3 → P-F3-4 (+P-F3-10) | Registrar una empresa desde el móvil y enviar la encuesta; el admin la aprueba | Entra en su panel; le llega «Tu empresa ya está dada de alta» |
| 2.6 | P-F3-5 (+P-F3-11) | Otra empresa: el admin la rechaza con un motivo | Le llega el correo con el motivo; puede corregir y reenviar |

### Sesión 3 — Equipo (empresa aprobada y empleados)

| Paso | Prueba | Qué se hace | Qué debe pasar |
|---|---|---|---|
| 3.1 | P-D21-1 (+P-F3-9, P-R04-1) | La empresa invita a un correo nuevo; desde el móvil se abre el correo, se pone nombre y contraseña | Llega la invitación (revisar el *spam*); entra directo a «Mi trabajo»; al dueño le llega «… se ha unido a tu equipo» y ve el aviso «Le falta: horario fijo · servicios» |
| 3.2 | P-R05-1 (+P-F5-2, P-D22-1) | El dueño le pone horario fijo y un servicio; luego cambia dos días sueltos | El aviso desaparece; al empleado le llegan 2 correos «Tienes un nuevo horario publicado»; en «Mi trabajo → Horario» lo ve sin poder cambiarlo |
| 3.3 | P-D21-2 | La empresa invita a un correo que ya tiene cuenta de cliente | Al entrar, acepta y pasa a empleado |
| 3.4 | P-F3-7 | El empleado sube su carnet; el admin lo aprueba | La empresa le puede asignar fitosanitarios |

### Sesión 4 — Vender y trabajar (cliente, empresa y empleado)

| Paso | Prueba | Qué se hace | Qué debe pasar |
|---|---|---|---|
| 4.1 | P-F4-1 (+P-R07-1) | El cliente reserva y paga 2 h con la empresa | La reserva es de la empresa y las horas, del empleado; el empleado **no** la ve aún en «Mi trabajo» |
| 4.2 | P-R06-1 | Empresa abierta en el ordenador y en el móvil; cerrar sesión en el móvil; en el ordenador, proponer un precio | No se cierra la sesión del ordenador; al cliente le llega el correo; la solicitud dice «Hace X min» |
| 4.3 | P-H40-1 (+P-R07-2) | Proponer solo +1 h; el cliente acepta | La hora de más, apartada al empleado; al confirmarse, al empleado le llega «Nuevo trabajo» y ya lo ve |
| 4.4 | P-R03-1 | El cliente, con la app instalada, pulsa «Actualizar» o vuelve a la app | Ve «Confirmada» |
| 4.5 | P-F5-3 | La empresa cambia quién va (a un segundo empleado) | Correo «Ya no vas» al primero y «Nuevo trabajo» al segundo |
| 4.6 | P-F6-1 | La empresa reparte un trabajo de 3 h entre dos personas | A cada una, su aviso con «Tu parte» |
| 4.7 | P-F6-2 (+P-H42-1, P-H44-1) | En el móvil, «Mover a otra fecha»; el cliente acepta | Pantalla fija sin scroll lateral; al cliente le llega el correo con inicio y fin; la reserva se mueve; aviso a quien va |
| 4.8 | P-F5-4 | Reserva para mañana: el cliente mira su reserva | Ve «Irá …» con nombre y foto el día antes, y no antes |

### Sesión 5 — Trabajos grandes, varios servicios y planes

| Paso | Prueba | Qué se hace | Qué debe pasar |
|---|---|---|---|
| 5.1 | P-F7-1 | Empresa con «hasta 2 personas a la vez» y dos empleados libres 4 h: reservar 8 h | «2 personas, 4 h»; a los dos les aparece |
| 5.2 | P-F7-2 | Un autónomo: trabajo de más de 12 h | Varios días, «del X al Y» |
| 5.3 | P-F8-1 | Césped y setos con un profesional que hace los dos | Un solo pago de gestión; la reserva enseña los dos servicios |
| 5.4 | P-F9-1 | Crear un plan quincenal desde una reserva | 7 días antes de la visita, «Tu próxima visita»; se confirma y se paga; a la empresa le llega marcada como visita del plan. **Tarda días en verse**: se deja programada |

### Sesión 6 — Móvil

| Paso | Prueba | Qué se hace | Qué debe pasar |
|---|---|---|---|
| 6.1 | P-R08-1 | Android (Chrome) y iPhone (desde el icono de la pantalla de inicio): «Mi cuenta → Activar notificaciones»; después, provocar un aviso (por ejemplo, una propuesta) | Llega la notificación con el mismo aviso que el correo; al tocarla, abre la pantalla |
| 6.2 | F6-07 | El panel del empleado al sol, sin ampliar | Se lee bien |

### Sesión 7 — Bajas, suspensión y limpieza (admin)

| Paso | Prueba | Qué se hace | Qué debe pasar |
|---|---|---|---|
| 7.1 | P-R09-1 | Suspender la empresa de prueba y buscarla como cliente; después reactivarla | Suspendida, no aparece para reservar y sus reservas siguen; reactivada, vuelve. Con PR-02 hecho, le llegan los correos |
| 7.2 | P-R02-1 | «Dar de baja o suspender»: revisar la empresa (con reservas) y cada cuenta de prueba | La empresa, «Aún no se puede» con el motivo; las cuentas sin reservas se borran enteras |
| 7.3 | Limpieza | Dar de baja o borrar todas las cuentas de prueba de estas sesiones, con la herramienta | Nada de prueba en producción (lo comprueba el chat) |

---

## 4. Registro

| Fecha | Qué | Resultado |
|---|---|---|
| 2026-09-29 | Documento creado; decisiones PR-02, PR-04 y PR-05 | — |
| 2026-10-08 | PR-01 cerrado (PR #41 fusionada el 2026-09-29). Procedimiento de corrección en `07-PROCEDIMIENTO-CORRECCION.md` | — |
