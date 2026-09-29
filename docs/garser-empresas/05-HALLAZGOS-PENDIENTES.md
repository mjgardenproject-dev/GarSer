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
| PH-01 | «Mi cuenta»: cambiar la foto y «Cerrar cuenta» dicen «hecho» y no guardan nada | **Alta** (el usuario cree que ha cerrado su cuenta) | H-13 | Baja real con comprobaciones | Por corregir |
| PH-02 | Un jardinero rechazado no puede volver a solicitar: «volver a intentarlo» no hace nada | **Alta** (bloquea para siempre a un solicitante) | Sospecha de `02` §3, **verificada** | Reabrir al momento, con histórico | Por corregir |
| PH-03 | Al reservar con una empresa, el cliente lee «Jardinero» y «Confirmar jardinero» | Media (texto) | H-28 (punto 1) | «Profesional» para todos | Por corregir |
| PH-04 | Al dar de baja una cuenta, sus ficheros (fotos, carnet) se quedan guardados | Media (datos personales) | Visto en F6 | Borrarlos también | Por corregir |
| PH-05 | El navegador puede escribir las marcas de idempotencia de sus operaciones | Baja (seguridad, solo le afecta a él) | Visto en F3 | Cerrarlo | Por corregir |
| PH-06 | `ARCHITECTURE.md` describe un sistema que ya no existe | Media (despista) | H-07 | Reescribirlo | Por corregir |
| PH-07 | 9 pruebas de preparación de servicios fallan porque están desactualizadas | Media (se pierde una red de seguridad) | H-27 | Ponerlas al día | Por corregir |
| PH-08 | Al aceptar otra fecha con cambio de persona, a quien va le llegan dos correos | Baja | Visto en F4 | Técnica (ver punto) | Por corregir |
| PH-09 | El historial de migraciones del Supabase **local** está desalineado | Baja (solo entorno) | Visto en F3 | Técnica | Por corregir |
| PH-10 | `02-HALLAZGOS.md` tiene hallazgos resueltos todavía marcados como abiertos | Baja (documentación) | `01-PLAN` §5c.6 | — | Por corregir |
| PH-11 | `booking_items` no se actualiza tras un cambio de precio | Vigilado (sin efecto hoy) | H-36 | Sin acción (regla) | Vigilado |
| PH-12 | Las solicitudes a varios jardineros siguen desactivadas | Informativo | H-20 | Sin acción | Informativo |
| PH-13 | Tareas de cierre del proyecto (datos de prueba, Stripe real, encuesta) | Operativo | `01-PLAN` §5c | Encuesta: dada por buena | En parte |

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
