# GarSer Empresas — Plan de implementación y progreso

> **Este fichero es el estado real del proyecto.** Si tu memoria o tu resumen de contexto
> dicen otra cosa, gana este fichero. Se actualiza al cerrar cada fase, no al empezarla.
>
> Antes de tocarlo, lee `00-GUIA-DEL-CHAT.md`.

**Estado global:** ✅ F0, F1 y F2 cerradas · ✅ F0–F6 cerradas · ✅ F5 cerrada · ✅ HITO hecho · ✅ F6 cerrada (planificación, repartir, trabajos partidos, mover de fecha) · ✅ F7 cerrada (equipos y trabajos de varios días) · siguiente F8 (multi-servicio) · ⏸ HITO tras F5 · D7 en borrador para validar
**Última actualización:** 2026-09-24
**Línea base de tests:** 473 en verde / 71 ficheros (tras F0) · `tsc` 129

---

## 0. Cómo se entrega este proyecto

**Decisión del usuario (2026-09-23):** GarSer Empresas se desarrolla y se prueba **entero en
local**. No se sube a GitHub ni se despliega nada a producción hasta que esté terminado y
probado. Al final se fusiona con el GarSer actual (`garser.es`) de una vez.

Consecuencias que el chat tiene que respetar:

- **Nada de `git push`** de `feat/garser-empresas` ni de despliegues de migraciones o funciones
  a producción mientras dure el proyecto. Los commits son locales.
- **Toda prueba se hace contra el Supabase local**, levantado desde esta carpeta.
- **La sección de acciones manuales de cada fase registra lo que habrá que hacer en
  producción al fusionar**, aunque no se haga todavía. Se va acumulando en §6.
- **El piloto del hito de F4 cambia** — ver el hito más abajo.
- **`main` avanza mientras tanto.** Antes de la fusión final habrá que traer a esta rama lo
  que haya entrado en `main`. Cuanto más dure el proyecto, más conviene hacerlo por el camino,
  al cerrar cada bloque, en vez de todo al final.

---

## 1. El razonamiento de negocio detrás del orden

GarSer cobra **una comisión del 12,5 % que paga el cliente por Stripe**; el importe del
servicio se abona en mano al profesional. De ahí salen dos únicas palancas de ingreso:
**más reservas** y **reservas más grandes**. Las empresas mueven las dos, pero no a la vez
ni con el mismo esfuerzo.

### Palanca A — Densidad de oferta (más reservas)

Un marketplace se cae cuando el cliente busca y no encuentra a nadie disponible. Cada
empresa que entra aporta la capacidad de N personas con **un solo proceso de alta**. En
términos de oferta, captar una empresa de 10 empleados equivale a captar 10 autónomos.
Es la vía rápida para que el funnel deje de quedarse sin profesionales.

### Palanca B — Tamaño del ticket (reservas más grandes)

Aquí está el dinero de verdad, y hoy está cerrado con llave:

> **GarSer no puede vender un trabajo de 40 horas.** El tope de 12 horas está codificado en
> **siete funciones SQL** distintas. No es una funcionalidad que falte: es demanda que se
> rechaza en la puerta.

Un trabajo de 4 h deja unos 12 € de comisión. Uno de 40 h deja unos 125 €. **Diez veces más
por transacción**, y son exactamente los trabajos que un autónomo no puede aceptar y una
empresa sí. Es la palanca de mayor retorno del proyecto — y por eso mismo va la última: sin
empresas que los ejecuten, no sirve de nada abrirla.

### La consecuencia sobre el orden

1. **Los cimientos no dan dinero, pero sin ellos lo demás se construye dos veces.** Las
   fases 0 y 1 no entregan nada visible y son, probablemente, un tercio del esfuerzo.
   Saltárselas significa rehacer las fases 5 a 9.
2. **Vender va antes que operar.** Una empresa con 3 empleados puede coordinarse por
   WhatsApp durante unas semanas; lo que no puede es no aparecer en el funnel. Una empresa
   que se da de alta y no recibe reservas se va.
3. **Operar va antes que crecer el ticket.** Una empresa que recibe un trabajo de 40 horas
   y no sabe repartirlo entre su gente lo hace mal, y eso sí quema al cliente.

### El hito que no hay que saltarse

Al terminar la **Fase 4**, una empresa real puede recibir y completar una reserva real.
**Ahí se para** y se hace un piloto con una empresa de verdad antes de construir el
planificador. Construir la pantalla de planificación sin haber visto a una empresa
planificar es la forma más cara de equivocarse en este proyecto.

---

## 2. Decisiones del usuario

Respondidas por el usuario el **2026-09-23**. Son de producto: el chat no las cambia.

| # | Pregunta | Respuesta del usuario | Qué cambia en el diseño | Fase |
|---|---|---|---|---|
| D1 | ¿La empresa paga la misma comisión? | **Sí, 12,5 %, igual que el autónomo.** | Nada. El modelo económico no se toca. | F4 |
| D2 | ¿La empresa pasa por el mismo alta que un autónomo? | **No. Alta de aprobación propia, con una encuesta para empresas** con las preguntas que interesan a GarSer. | Solicitud de empresa **separada** de `gardener_applications`, con su revisión en el panel de admin. Ver A-11. Genera **D7**. | F3 |
| D3 | ¿El dueño cuenta como mano de obra? | **El dueño elige si trabaja o no.** | Interruptor «Yo también trabajo». Si lo activa, tiene su disponibilidad y sus servicios como un empleado más y cuenta como capacidad. Si no, no cuenta. | F3, F4 |
| D4 | ¿Vale el carnet fitosanitario de la empresa o hace falta el de cada empleado? | **Cada empleado tiene que tener adjuntado su carnet.** | El carnet es **por persona**. El de la empresa no cubre a sus empleados. Ver A-13 y la nota de interpretación de abajo. | F3, F5 |
| D5 | ¿Los empleados tienen especialidades? | **Sí. Al crear un empleado, el empresario marca qué servicios hace.** Al asignar, solo aparecen los empleados con ese servicio activo. | La capacidad de la empresa se calcula **por servicio**, no en bloque. Ver A-12. **Adelanta trabajo de F6 a F3 y F4.** | F3, F4, F5 |
| D6 | ¿El cliente ve quién va a ir? | **Aceptada la recomendación.** | Nombre y foto del trabajador asignado, **el día antes**. Ni antes ni más datos. | F5 |
| D9 | ¿Cómo se mueve un trabajo de fecha, si la eligió el cliente? (2026-09-24) | **Proponiéndoselo al cliente**, que acepta o rechaza, como un cambio de precio. | Propuesta de nueva fecha/hora; al aceptar se mueve la agenda sola; al rechazar no cambia nada. | F6 |
| D10 | ¿Cómo se divide un trabajo entre varias personas? (2026-09-24) | **La empresa lo reparte como vea conveniente**, pero **tiene que poder no aceptar trabajos partidos**: entonces no se muestra al cliente si una sola persona no puede cubrirlo. **Es distinto de los trabajos de varios días.** | La empresa reparte las horas de un trabajo entre su gente (por tramos). Ajuste de la empresa «Aceptar trabajos partidos»: apagado (por defecto) = solo se vende si una persona hace el trabajo entero (lo de F4); encendido = también si entre varias, por turnos, cubren todas las horas. Varios días = F7. | F6 |
| D11 | ¿Quién decide cuántas personas van a la vez? (2026-09-24) | **La empresa, con un límite** en su configuración («hasta N personas a la vez»). GarSer arma el equipo solo para acabar cuanto antes con la gente libre. | Ajuste de la empresa; el precio no cambia con el número de personas (sale de las horas de trabajo). Autónomo: siempre 1. | F7 |
| D12 | ¿Los trabajos de varios días son solo para empresas? (2026-09-24) | **También para autónomos.** | Cambia el funcionamiento actual del autónomo: hoy un trabajo de más de 12 h no se puede reservar (T7); pasará a ofrecerse repartido en varios días. | F7 |
| D13 | En varios días, ¿cuántas horas al día trabaja cada persona? (2026-09-24) | **Las que tenga libres**, sin máximo propio (con el tope de 12 h por jornada). | Cada persona aporta cada día sus horas libres seguidas. | F7 |
| D14 | Varios servicios en una reserva, ¿un solo profesional? (2026-09-24) | **Uno para todo.** | Una reserva = un proveedor, una visita, un pago. Quien quiera profesionales distintos hace reservas separadas. | F8 |
| D15 | Con varios servicios, ¿qué profesionales ve el cliente? (2026-09-24) | **Solo los que hacen todos** (y con carnet si alguno lo exige). | Sin cobertura parcial entre servicios. | F8 |
| D16 | En una empresa, con varios servicios, ¿quién puede ir? (2026-09-24) | **Quien hace todos los servicios del trabajo.** | Las personas del trabajo tienen asignados todos sus servicios (y carnet si hace falta): el planificador de F7 no cambia de fondo. | F8 |

> **D4, precisión confirmada por el usuario (2026-09-23):** el carnet se exige **solo a los
> empleados que ofertan servicios fitosanitarios**. Sin su carnet adjuntado y aprobado no se
> les puede activar ese servicio ni asignarles esos trabajos. A quien no hace fitosanitarios
> no se le pide.

### Pendiente

| # | Pregunta | Bloquea | Por qué |
|---|---|---|---|
| D8 | ~~¿Se arregla H-11 ya en producción?~~ | — | **Respondida (2026-09-23): no es urgente**, `garser.es` aún no tiene usuarios reales. Se arregla con F0 el día de la fusión (§6). **Si antes de la fusión entran usuarios reales, esta decisión debe revisarse.** |
| D7 | **¿Qué preguntas lleva la encuesta de alta de empresas?** | F3 | Sale de D2. **Borrador propuesto el 2026-09-24** en F3 («D7 — Borrador»), pendiente de que el usuario lo ajuste. Se implementa de forma que cambiar preguntas no exija migración. |

---|---|---|---|
| D1 | **¿Una empresa paga la misma comisión del 12,5 %?** ¿O hay tramos por volumen? | F4 | Cambia el modelo económico. Por defecto: igual que el autónomo. |
| D2 | **¿Una empresa pasa por el mismo alta con aprobación que un autónomo** (`gardener_applications`)? | F3 | Es el control de calidad de la oferta. Por defecto: sí, mismo circuito. |
| D3 | **¿El dueño de la empresa cuenta como mano de obra?** | F4 | En empresas pequeñas el dueño trabaja. Campo previsto: `company_members.counts_as_labour`. |
| D4 | **Carnet fitosanitario: ¿vale el de la empresa o hace falta el del empleado que aplica?** | F5 | **Es una cuestión legal, no técnica** (RD 1311/2012). Ver hallazgo H-04. |
| D5 | **¿Los empleados tienen especialidades**, o la capacidad es indistinta? | F6 | Hoy la capacidad es fungible. Añadirlo después es fácil; quitarlo, no. |
| D6 | **¿El cliente ve quién va a ir a su casa?** | F5 | Recomendación: nombre y foto, el día antes. Ni antes, ni más datos. |

---

## 3. Las fases

Leyenda: ⬜ no empezada · 🟨 en curso · ✅ cerrada · ⛔ bloqueada

### BLOQUE 0 — Cimientos
*No entrega funcionalidad visible. Es obligatorio y es donde está el riesgo de regresión.*

#### ✅ F0 — Una sola fuente de verdad para el rol

**Problema.** Hoy el tipo de cuenta se deduce de cinco sitios a la vez: `user_metadata.role`,
`user_metadata.requested_role`, `localStorage.signup_role`, `profiles.role`, la existencia de
`gardener_profiles` y el estado de `gardener_applications`. Hay 8 apariciones en `App.tsx` y
más en `AuthForm.tsx`. Una de esas fuentes (`localStorage`) la controla el cliente.

> **⚠ Rediseñada el 2026-09-23 tras investigar (H-11, H-12, H-14).** Parte de lo previsto ya
> existía (`profiles_role_check`, el disparador `prevent_role_escalation`), y apareció algo
> que no estaba en el diseño: **nada crea el perfil de un usuario nuevo**, y eso abre una
> escalada a admin. El orden dentro de la fase pasa a ser: primero perfil garantizado y
> seguro en el servidor, después unificar la lectura en el frontend.

**Trabajo — parte servidor (primero):** ✅ **hecho** (migración `20260923120000_empresas_f0_profile_on_signup.sql`)
- [x] Disparador `trg_provision_profile` en `auth.users` que crea el perfil al registrarse.
      Rol desde la intención del registro, **restringido a `client` | `gardener`**; nunca `admin`.
- [x] Cerrada la creación de perfiles desde el cliente (H-11): `REVOKE INSERT` + fuera las
      dos policies de INSERT + guarda `prevent_role_escalation_on_insert`.
- [x] Relleno: perfil para toda cuenta sin él; aprobados con `gardener_profiles` → `gardener`.
- [x] `profiles_role_check` ampliado a 5 valores.
- [x] **Imprevisto (H-15):** `search_path` fijado en `prevent_duplicate_profiles` y
      `auto_provision_corporate_admin`. Sin esto, el disparador nuevo rompía todos los registros.
- [x] `supabase/seed.sql`: los perfiles de prueba ahora se **completan** (`UPDATE`) en vez de
      crearse, porque ya los crea el disparador.
- [x] Verificación repetible: `node scripts/garser-empresas/verify-f0-db.mjs` → 7/7.

**Trabajo — parte frontend (después):** ✅ **hecho**
- [x] `src/lib/accountRole.ts` (5 roles + normalización) y `src/contexts/AccountContext.tsx`
      (`useAccount()`): el rol se lee **una vez por sesión** de `profiles.role` y lo comparten
      todas las pantallas. Descarta respuestas de una sesión anterior.
- [x] Sustituidas todas las deducciones: `App.tsx` (5 sitios), `AuthContext` (inicio de
      sesión), `AuthForm`, `MyAccount`, `Navbar` (tenía consulta propia), `BottomNav` (H-16).
- [x] Fuera `localStorage.signup_role` y toda lectura de rol desde `user_metadata`. Queda
      `user_metadata` solo como vehículo de la intención del alta, que lee el servidor.
- [x] `RoleMonitor.tsx` reconvertido: solo corrige hacia arriba (H-14).
- ~~`REVOKE UPDATE (role)`~~ → ya lo cubre el disparador `prevent_role_escalation` (probado).

**Criterio de cierre.** Cero cambios visibles. 462 tests siguen en verde. Un cliente sigue
yendo a su panel, un autónomo al suyo, un admin al suyo, y los estados de solicitud
(pendiente/denegada/activa) siguen redirigiendo igual.

**Cierre (2026-09-23).** Cumplido, con una salvedad honesta: **no ha sido del todo
invisible**. Tres cosas que ya estaban programadas pero nunca funcionaban en producción
(porque los usuarios no tenían perfil) empiezan a funcionar. Ver «Cambios que notarán los
usuarios» en §6. Verificado: 473 tests, build, `tsc` 129, lint 0 errores, servidor 7/7, y
recorrido en navegador con 5 tipos de cuenta (ver `03-PRUEBAS.md`).

**Riesgo.** Alto: es la lógica que decide qué ve cada usuario al entrar. Se prueba con las
cuatro cuentas sembradas antes de cerrar.

---

#### ✅ F1 — El registro de capacidad

**Problema.** `booking_blocks(booking_id, date, hour_block)` no sabe **quién** trabaja: se
deduce de `bookings.gardener_id`. Mientras el trabajo lo haga una persona funciona; en cuanto
lo ejecutan dos empleados, o se reparte en varios días, el modelo no puede representarlo.

**Trabajo.** ✅ **hecho** (migración `20260923130000_empresas_f1_capacity_ledger.sql`)
- [x] `booking_blocks.assignee_id` + relleno desde `bookings.gardener_id` + `SET NOT NULL`.
      La migración **se detiene sin tocar nada** si hay bloques sin atribuir o dobles ventas.
- [x] `UNIQUE (assignee_id, date, hour_block)` — la doble venta es imposible por esquema.
- [x] ~~Las tres funciones~~ → **eran cinco escritoras** (H-17). No se reescriben: un
      disparador rellena `assignee_id` cuando no se indica (A-15).
- [x] **Imprevisto (H-18):** `ON CONFLICT DO NOTHING` sin destino en tres funciones →
      con destino `(booking_id, date, hour_block)`.
- [x] `release_booking_schedule` libera las horas de **quien las trabajaba**.
- [x] H-01 resuelto: `reserve` y `resize` deciden con `availability` (A-16). Arregla un fallo
      que ya existía (el jardinero no podía aceptar o alargar horas que la web ofrecía).
- [x] `BookingRequestsManager.tsx`: **sin cambios** — no lee la tabla, construye un array
      sintético (H-05).
- [x] Tipos regenerados (`database.types.ts`, +4 líneas).
- [x] Verificación repetible: `node scripts/garser-empresas/verify-f1-schedule.mjs` → 13/13
      (5/11 antes de la migración).

**Criterio de cierre.** Una reserva de autónomo se crea, se redimensiona y se cancela
exactamente igual que antes. 462 tests en verde. Comprobación explícita de que no quedan
`assignee_id` a `NULL`.

**Riesgo.** Crítico. Es el punto de no retorno del proyecto. **Antes de migrar** hay que
consultar si existen solapes en producción: si el índice único falla al crearse, son dobles
reservas reales que hay que resolver a mano.

**Cierre (2026-09-23).** Cumplido. Probado además **sobre datos existentes**, que es lo que
pasará en producción: con reservas normales la migración atribuye todas las horas al
jardinero; con una doble venta ya existente, o con una hora sin reserva, se detiene y no
toca nada. Tras `db reset` desde cero: 115/115 migraciones, F1 13/13, F0 7/7, 473 tests,
build, `tsc` 129. Concurrencia real repetida tres veces: siempre una sola ganadora.

---

### BLOQUE 1 — Una empresa puede vender
*Desde aquí hasta el primer euro.*

#### ✅ F2 — El proveedor como concepto

✅ **hecho** (migración `20260924120000_empresas_f2_provider_model.sql`)
- [x] `gardener_profiles.provider_kind` (`'solo'` | `'company'`), `DEFAULT 'solo'`; nadie
      puede cambiárselo a sí mismo.
- [x] `COMMENT ON COLUMN bookings.gardener_id`: *proveedor responsable*.
- [x] Tablas `companies`, `company_members`, `company_invitations` **y
      `company_member_services`** (D5, A-12: adelantada desde F3 porque es modelo, no pantalla).
      `counts_as_labour` en `company_members` (D3).
- [x] `my_company_id()`, `is_company_member()`, `is_company_owner()`,
      `can_read_company_member()` — `SECURITY DEFINER`.
- [x] RLS: solo lectura (A-17, A-18). Admin lee todo.
- [x] Integridad en la BD: empleado ≠ proveedor (A-03), una empresa activa por persona, un
      dueño por empresa, el dueño es la cuenta de la empresa (A-19).
- [x] **Imprevisto (H-21, crítico):** cerrado el alta de proveedores desde el navegador y la
      autoaprobación del carnet. `ProfileSettings.tsx` ya no intenta crear la ficha.
- [x] Tipos regenerados. Verificación repetible:
      `node scripts/garser-empresas/verify-f2-db.mjs` → 18/18 (1/17 antes de la migración).
- **No incluido, a propósito:** la solicitud de alta de empresa (A-11) depende de D7 y va en F3;
  el carnet por empleado (A-13) toca `gardener_licenses` y va en F3 con su subida.

**Criterio de cierre.** Todo lo existente queda como `'solo'` y se comporta igual. Las RLS se
prueban con dos empresas sembradas, contra la API, no contra la interfaz.

**Cierre (2026-09-24).** Cumplido. Dos empresas desechables (dueño + 2 empleados; dueño + 1),
un cliente, un visitante y el admin, todos contra la API. Tras `db reset` desde cero: 116/116,
F2 18/18, F1 13/13, F0 7/7, 473 tests, build, `tsc` 129.

---

#### ✅ F3 — Alta de empresa y de empleados

**✅ F3.1 Servidor — hecho** (migración `20260924130000_empresas_f3_onboarding_server.sql`,
`node scripts/garser-empresas/verify-f3-db.mjs` → 31/31):
`company_applications` + `submit_` y `admin_review_company_application`; invitaciones
(`create_`, `revoke_`, `accept_company_invitation`); equipo (`set_company_member_services`,
`set_company_owner_works`, `deactivate_company_member`); carnet por persona
(`has_valid_phyto_license`, retirada automática del servicio si deja de ser válido); el dueño
lee los perfiles de su equipo; cambio de rol de confianza (A-21). **Imprevisto: H-22.**
Un fallo propio cazado a tiempo: el mensaje de «faltan campos» salía como error técnico de
Postgres; la prueba ahora exige el texto correcto.

**✅ F3.2 Web del alta — hecho:**
- Registro: tercera opción **«Empresa — Tengo un equipo de jardinería»** en `AuthForm`
  (`/auth?mode=signup&role=company` la preselecciona). El subtítulo de «Jardinero» pasa de
  «Ofrezco servicios» a «Trabajo por mi cuenta», para distinguirlo de la empresa.
- Encuesta de 5 pasos (`/empresa/solicitud`), generada desde `src/config/companyApplication.ts`
  (D7 en un solo fichero). Guarda el borrador en cada paso, dice qué falta en vez de solo
  bloquear, y al volver retoma en el primer paso pendiente.
- Página de estado (`/empresa/estado`): en revisión / no aceptada con el motivo y «Corregir y
  enviar de nuevo» (abre un borrador nuevo con los datos; la rechazada queda de histórico).
- Admin: sección **«Solicitudes de Empresas»** en Usuarios, separada de las de jardineros,
  con todas las respuestas en lenguaje humano, aprobar (con confirmación) y rechazar (con
  motivo obligatorio).
- `/empresa` decide adónde va cada cuenta según su alta; el contenido del panel llega en F3.3.
- Migración `20260924140000`: el correo de la solicitud lo copia el servidor al enviar.

**✅ F3.3 Web de uso — hecho** (migración `20260924150000_empresas_f3_team_overview.sql`,
verificación F3 35/35):
- **Panel de empresa** (`/empresa`), pestañas **Equipo** y **Tu empresa**. Equipo: invitar por
  correo (enlace para copiar), invitaciones pendientes con «Anular», una tarjeta por persona con
  teléfono, estado del carnet, servicios (editor que solo ofrece los que la empresa tiene activos
  y bloquea fitosanitarios sin carnet) y «Dar de baja» con confirmación; el titular con «Yo
  también trabajo». Tu empresa: datos fiscales y enlace a servicios/precios/zona.
- **`/empresa/configuracion`**: la misma pantalla de configuración que un autónomo (A-26).
  **Desviación del plan:** adelantado de F4, porque sin servicios activos no hay nada que
  repartir entre el equipo. Lo que queda en F4 (vender) no cambia.
- **Invitación** (`/invitacion?token=…`, pública): dice quién invita (A-25), lleva a crear la
  cuenta o entrar con ese correo, explica cada caso que no puede aceptar, y se retoma sola tras
  confirmar el correo (H-25).
- **Panel del empleado** (`/mi-trabajo`): empresa, sus servicios, «todavía no tienes trabajos»,
  nombre y teléfono, y su carnet si la empresa hace fitosanitarios.
- El admin ve el carnet de un empleado como «Nombre · empleado de Empresa».
- Etiqueta «Empleado» en el menú y en Mi cuenta. **Imprevistos:** H-23, H-24, H-25.

**Pendiente de F3:**
- [x] Registro «Tengo una empresa de jardinería» en `AuthForm`.
- [x] **Solicitud de alta de empresa propia** (D2): encuesta de empresa (preguntas de D7),
      tabla separada de `gardener_applications`, y su revisión en el panel de admin. Hasta que
      el admin la aprueba, la empresa no aparece en el funnel.
- [x] Interruptor del dueño «Yo también trabajo» (D3).
- [x] Alta de empleado con **selección de servicios** (D5). Solo se pueden marcar servicios
      que la empresa tiene activos.
- [x] **Carnet fitosanitario por empleado** (D4): subida del carnet en la ficha del empleado,
      aprobación por el admin, y sin carnet aprobado no se le puede activar ese servicio.
- [x] Invitación por token: se guarda **el hash**, nunca el token.
- [x] Email de invitación — tipo nuevo en el despachador Brevo existente (F3.4).
- [x] RPC `accept_company_invitation(token)`: deriva `company_id` **del token**, jamás de un
      parámetro. Rechaza si quien acepta ya tiene `gardener_profiles`.
- [x] Panel de empresa mínimo: perfil y equipo.

**Criterio de cierre.** Una empresa aprobada por el admin, con un empleado con servicios
asignados, existe y ambos entran a su panel. Probado el vector de suplantación de
`company_id`.

**Cierre (2026-09-24).** Cumplido: «Jardines Demo Costa» aprobada, con Lucía Martín como
empleada (césped + fitosanitarios, carnet aprobado por el admin), los dos entran a su panel en
el móvil. F3-04 en verde. Batería: 486 tests, build, `tsc` 129, F0 7/7, F1 13/13, F2 18/18,
F3 35/35, correos 10/10.

**✅ F3.4 Correos — hecho** (migración `20260924160000_empresas_f3_invitation_email.sql`,
`send-email-notification`, `node scripts/garser-empresas/verify-f3-emails.mjs` → 10/10):
- **Invitación:** al invitar, la web pide el correo; el servidor solo lo envía si quien lo pide
  es el dueño, el token coincide con la huella, la invitación sigue viva y **no se envió antes**
  (una vez por invitación). Tope de **20 invitaciones al día por empresa** (A-27). Si el correo
  falla, la tarjeta lo dice y deja el enlace para mandarlo a mano.
- **Empresa aprobada / rechazada:** solo el admin; destinatario y motivo salen de la solicitud,
  y solo se envía si la solicitud está de verdad en ese estado (A-28).

**Diseño detallado (2026-09-24), tras estudiar las piezas existentes que se reutilizan:**

La fase se entrega en cuatro partes, cada una probada y commiteada antes de la siguiente:

| Parte | Qué | Reutiliza |
|---|---|---|
| **F3.1 Servidor** | `company_applications` + su revisión, invitaciones, gestión del equipo, carnet por persona | El patrón de `gardener_applications` (borrador → enviada por el usuario; aprobación solo por RPC de admin), que se ha comprobado seguro |
| **F3.2 Web: alta** | Registro «Tengo una empresa», encuesta, página de estado, revisión en el admin | `AuthForm`, `GardenerStatusPage`, la estructura de `ApplicationsAdmin` |
| **F3.3 Web: uso** | Panel de empresa (perfil, «Yo también trabajo», equipo e invitaciones, servicios por empleado), aceptar invitación, panel mínimo del empleado (perfil y carnet) | `PhytosanitaryLicenseUpload` para el carnet del empleado |
| **F3.4 Emails** | Invitación, empresa aprobada, empresa rechazada | El despachador `send-email-notification`: el destinatario lo resuelve el servidor, nunca el navegador |

Decisiones técnicas nuevas (detalle en `02-HALLAZGOS.md` §2, A-20 a A-24):
- `company` se puede declarar al registrarse, igual que `gardener`: significa «se registró como
  empresa», no «aprobada». Aprobada = existe su fila en `companies`. `employee` nunca se declara.
- Cambiar el rol a `employee` al aceptar una invitación lo hace el servidor con una marca de
  confianza de la transacción, que respeta el disparador de escalada de F0.
- Aceptar una invitación exige que el correo de la sesión sea el invitado, y que la cuenta sea de
  cliente: ni proveedor ni miembro de otra empresa.
- Las licencias dejan de exigir ficha de proveedor: un empleado puede tener carnet (A-13).

### D7 — Borrador de la encuesta de alta de empresas (para que el usuario lo ajuste)

Implementado de forma que cambiar preguntas no exija tocar la base de datos: los datos que
necesita la aprobación van en columnas; el resto, en un campo de respuestas flexible.

| Bloque | Preguntas | Por qué la pregunta GarSer |
|---|---|---|
| **Empresa** | Nombre comercial\*, razón social\*, CIF\*, año de inicio de actividad, web o redes | Identificar a la empresa y verificarla; el nombre comercial es el que verá el cliente |
| **Contacto y zona** | Persona de contacto\*, teléfono\*, dirección\*, zona donde trabajáis\* | Contactar, y saber si cubre la zona donde está la demanda |
| **Equipo** | Nº de trabajadores\* (1 / 2–5 / 6–10 / 11–20 / más de 20), ¿el titular trabaja en los servicios?\* (D3), nº de vehículos | Dimensionar su capacidad, que es el valor de una empresa para GarSer |
| **Servicios** | Qué servicios ofrecéis\* (los 7), ¿tenéis trabajadores con carnet fitosanitario? | Qué oferta aporta; el carnet real se verifica luego por persona (D4) |
| **Garantías** | ¿Seguro de responsabilidad civil?\*, aseguradora, maquinaria propia | Riesgo: una empresa manda a varias personas a casas ajenas |
| **Referencias** | Descripción del negocio, fotos de trabajos (opcional) | Calidad del trabajo |
| **Compromisos** | Acepta las condiciones\*, declara que los datos son ciertos\* | Igual que el alta de jardinero |

\* obligatoria.

---

#### ✅ F4 — La empresa vende

**✅ F4.1 Servidor — hecho** (migración `20260925120000_empresas_f4_sell_by_person.sql`,
`booking-authority`, `booking-payment`, `bookingEligibilityCore.ts`;
`node scripts/garser-empresas/verify-f4-sell.mjs` → 21/21):
- **Decisión del usuario (H-26 → A-29):** al vender se aparta a una persona concreta; el dueño
  elige en su configuración si es definitiva o una propuesta que confirma él. Sustituye al
  `free_count` del plan.
- `provider_free_hours()` = única fuente de horas libres para la web y el pago (A-30).
- Pago, confirmación, aceptar, alargar y cancelar operan por persona. Autónomo: idéntico
  (F1 13/13; baterías de servicios con los mismos resultados que antes, H-27).
- Distintivo: `public_gardener_directory.provider_kind`.
- **Horarios del equipo: F5** (decisión del usuario). Hasta entonces una empresa real no tiene
  horas que vender; las pruebas cargan horarios a mano.

**✅ F4.2 Web — hecho:**
- Listado del cliente: distintivo **«Empresa»**.
- La empresa ve sus **solicitudes** (`/empresa/solicitudes`, la misma pantalla del autónomo para
  aceptar, rechazar o proponer otro precio) y sus **reservas** (`/bookings`, la del autónomo), con
  **«Va: …» / «Propuesta para ir: …»** en cada una. Accesos en el panel, con el número de
  solicitudes por aceptar.
- «Tu empresa» → **«¿Quién va a cada trabajo?»**: «GarSer elige automáticamente» o «Yo elijo
  quién va» (A-29).

**Cierre (2026-09-24).** Cumplido: el cliente encontró a la empresa en el listado, reservó con
el mismo precio y la misma comisión (12,5 %) que un autónomo, el pago apartó a Lucía, el aviso
de Stripe (simulado, sin tarjetas) creó la reserva y la empresa la aceptó y la ve con «Va:
Lucía Martín». Autónomo sin cambios (F1 13/13, baterías de servicios iguales que antes). El
cobro real con Stripe queda para P-F4-1 el día de la fusión.


- [x] ~~Vista~~ Función `provider_free_hours` sobre la tabla de disponibilidad que quede tras H-01,
      **calculada por servicio** (D5): una empresa solo tiene hueco para el servicio X si hay
      libre un empleado que hace el servicio X. El dueño cuenta solo si trabaja (D3).
- [x] `booking-authority` lee capacidad — **por persona**, no `free_count` (H-26, A-29).
      **Recordatorio: esta función importa `bookingQuoteCore.ts` → hay que redesplegarla.**
- [x] La empresa configura precios con los configuradores existentes, sin tocarlos.
      *(Adelantado a F3.3, A-26: `/empresa/configuracion`.)*
- [x] **Fitosanitarios a nivel de empresa:** una empresa sin nadie con carnet que haga el
      servicio no tiene horas que vender para un trabajo que lo exige (F4-14): la puerta es por
      persona, no por la ficha.
- [x] La empresa aparece en `ProvidersPage` con distintivo discreto. Comisión 12,5 % (D1).

**Criterio de cierre.** **Primera reserva a una empresa, de punta a punta**, incluida la
comisión por Stripe. Verificado en paralelo que el funnel del autónomo no ha cambiado.

> ### ⏸ HITO — Recorrido completo en local, con el usuario haciendo de empresa
> Como el proyecto no sale a producción hasta el final (§0), el piloto con una empresa real
> no es posible aquí. En su lugar: **el usuario recorre en local el camino entero de una
> empresa** — alta, aprobación, empleados, precios, recibir una reserva — antes de construir
> el planificador. Lo que se aprenda ahí manda sobre el diseño de F5 y F6.
>
> El piloto con una empresa real pasa a ser el **primer paso después de la fusión**.
>
> **✅ Hecho el 2026-09-24** (tras F5, por petición del usuario lo hizo el chat en el navegador,
> en móvil). Recorrido: Lucía pone su horario fijo (L-V 9-17) → Laura reserva césped con la
> empresa (distintivo, mismo precio, horas de Lucía) → el pago aparta a Lucía (Stripe simulado)
> → Marta ve la solicitud con «Va: Lucía Martín» y la acepta → a Lucía le llega «Nuevo trabajo»
> y lo ve en «Semana» con dirección, cliente y qué hacer. **Todo funciona de punta a punta.**
>
> **Lo aprendido, que manda sobre F6:**
> 1. **La dueña no tiene una vista de «quién hace qué y cuándo».** «Reservas» es una lista de
>    tarjetas una detrás de otra; con 2 trabajos va bien, con 20 en una semana y 5 personas no.
>    Falta el planificador por persona y día → es F6.
> 2. **La dueña no ve el horario de su equipo** (quién está libre cuándo); solo lo descubre al
>    abrir «Cambiar quién va» en un trabajo concreto. El planificador tiene que mostrarlo.
> 3. **El panel de la empresa mezcla cosas:** la pestaña «Equipo» abre con «Solicitudes» y
>    «Reservas». Con el planificador, el panel pasa a abrir en la agenda.
> 4. **El empleado ve «Reservas» en su barra inferior** y le lleva a la lista de reservas de
>    **cliente** (las suyas propias como cliente, vacía): confunde. Su barra debe llevar a «Mi
>    trabajo».
> 5. En el listado del cliente, con dos o más profesionales la tarjeta de la empresa queda fuera
>    de la pantalla (carrusel horizontal): es el comportamiento de siempre con varios
>    autónomos, no de empresas. Anotado, fuera de alcance.

---

### BLOQUE 2 — Una empresa puede operar
*Retención de la oferta que se acaba de captar.*

#### ✅ F5 — Asignar y ejecutar

**Orden elegido (2026-09-24):** F5.1 horarios del equipo (sin horarios no hay qué asignar; la
pantalla estaba en «Panel de empleado») → F5.2 servidor de asignación y ejecución → F5.3 web
(panel del empleado y «cambiar quién va») → F5.4 correos y D6. El ⏸ HITO (recorrido haciendo de
empresa) se hace tras F5, cuando ya hay horarios.

**✅ F5.1 Horarios del equipo — hecho** (migración `20260925130000_empresas_f5_team_schedules.sql`,
`verify-f5-schedules.mjs` → 9/9):
- El empleado pone su horario en «Mi trabajo» → «Mi horario» (`/mi-trabajo/horario`) y el dueño
  que trabaja en su tarjeta → «Mi horario» (`/empresa/horario`): la **misma pantalla** del
  autónomo, con lo ocupado sacado de su propia agenda.
- **Imprevisto H-29** cerrado: una hora vendida ya no se puede reabrir por ningún camino (A-32),
  y al dueño que trabaja no se le cierran las horas de todo su equipo.
- Antelación mínima = de la empresa (A-31), en «Tu empresa».

**✅ F5.2 Servidor de asignación y ejecución — hecho** (migración
`20260925140000_empresas_f5_assign_and_work.sql`, `verify-f5-assign.mjs` → 13/13):
- `my_jobs()`: el empleado ve **sus** trabajos con lo justo para hacerlos (A-33, en lugar de
  ampliar `shares_booking_with`).
- `booking_assignment_candidates()` / `assign_booking_worker()`: el dueño ve quién puede ir y
  elige; servidor comprueba servicio, carnet y horas (A-34).
- Detalle del trabajo y «he terminado» también para quien va. «Marcar inicio» no existe en
  GarSer (tampoco para autónomos): no se añade.

**✅ F5.3 Web — hecho:**
- «Mi trabajo» del empleado en pestañas **Hoy / Semana / Perfil** (su horario, en «Semana»).
  Cada trabajo: hora, servicio, dirección con «Cómo llegar», cliente con «Llamar», «Qué hay que
  hacer» y «He terminado» cuando ya ha empezado.
- El dueño, en sus solicitudes y reservas: **«Cambiar quién va»** (lista de quién puede ir, libre
  u ocupado) y, en modo «yo elijo», **«Confirmar»** la propuesta.
- **H-30** (bucle de pintado en «Horario fijo», anterior al proyecto) arreglado.

**✅ F5.4 Avisos y D6 — hecho** (migración `20260925150000_empresas_f5_client_sees_worker.sql`,
`send-email-notification`, `verify-f5-client.mjs` → 7/7):
- Correos al empleado «Nuevo trabajo» y «Ya no vas a este trabajo» (A-36).
- D6: el cliente ve **«Irá Ana G.»** con foto el día antes (A-35); la agenda por horas deja de
  ser legible para el cliente (H-28).
- **Imprevisto H-31** cerrado: el cliente veía a la empresa con el nombre personal del dueño.

**Cierre (2026-09-24).** Cumplido lo que pedía el plan de F5, con las pruebas F5-01 a F5-12 en
verde salvo el matiz de F5-05 (no existe «marcar inicio»). Batería: 493 tests, build, `tsc` 129,
F0 7/7, F1 13/13, F2 18/18, F3 35/35, correos 10/10, F4 21/21, F5 9/9 + 13/13 + 7/7.


- [x] Asignación mínima: el dueño elige empleado de una lista de quién está libre **y hace
      ese servicio** (D5). En trabajos fitosanitarios, solo quien tiene carnet aprobado (D4).
      *(Servidor F5.2; pantalla F5.3.)*
- [x] ~~Extender `shares_booking_with()`~~ → `my_jobs()` (A-33). Mínimo privilegio: **asignado**,
      no *de la empresa*.
- [x] Panel de empleado: Hoy / Mi semana / Mi disponibilidad / Perfil.
- [x] Emails de asignación y de cambio.
- [x] Puerta de carnet fitosanitario en la asignación, **por empleado** (D4, H-04).
- [x] El cliente ve nombre y foto de quién va, **el día antes** (D6).

#### ✅ F6 — Planificación y reasignación

**Diseño (2026-09-24), tras el hito y D9/D10.** Tres partes:
- **F6.1 Servidor:** agenda de la empresa en una llamada (`company_schedule`), repartir las
  horas de un trabajo (`assign_booking_hours`, D10), ajuste «Aceptar trabajos partidos» y venta
  por turnos cuando está encendido.
- **F6.2 Web:** planificador móvil primero en tres densidades (Día por persona, Semana persona ×
  día, Lista), «Repartir» con los conflictos a la vista **antes** de confirmar, el panel abre en
  la agenda, y la barra inferior del empleado lleva a «Mi trabajo» (lo aprendido en el hito).
- **F6.3 Mover de fecha** con propuesta al cliente (D9), con sus correos.

**✅ F6.1 Servidor — hecho** (migración `20260925160000_empresas_f6_planning_server.sql`,
`booking-authority`, `booking-payment`, `send-email-notification`; `verify-f6-planning.mjs` →
12/12): una persona por hora en todo el camino del dinero (A-37), venta por turnos opcional
(A-38), `assign_booking_hours`, `company_schedule`, «Tu parte» en los correos y en «Mi trabajo».

**✅ F6.2 Planificador web — hecho** (migración `20260925170000_empresas_f6_hour_options.sql`):
- El panel de la empresa abre en **Agenda**: **Día** (una fila por persona con sus horas libres,
  sus trabajos y los «por aceptar»), **Semana** (persona × día; tocar lleva al día) y **Lista**
  (próximos 14 días, con quién va y su parte).
- Tocar un trabajo abre su **hoja**: quién hace cada hora, atajos «todo a …», y los ocupados
  marcados y sin poder elegirse **antes** de guardar (F6-03). Avisos por correo a quien entra y a
  quien sale.
- «Tu empresa» → **«Aceptar trabajos partidos»** (D10).
- Del hito: barra inferior del empleado «Mi trabajo · Horario · Cuenta»; en «Reservas» y
  «Solicitudes», «Van: Ana (9–10 h) y Luis (10–12 h)» si está repartido; «Tu parte» en la
  tarjeta del empleado.
- F6-06 (20 personas, 375 px) en verde tras dejar que los nombres largos partan línea.

**✅ F6.3 Mover de fecha — hecho** (migración `20260925180000_empresas_f6_reschedule.sql`,
`send-email-notification`; `verify-f6-reschedule.mjs` → 9/9): en la hoja del trabajo, «Mover a
otra fecha» con las horas posibles de cada día; el cliente ve la propuesta en su tarjeta y la
acepta o mantiene su fecha; correos a cada parte (A-39).

**Cierre (2026-09-24).** F6-01 a F6-06 en verde (F6-07, «legible al sol en móvil real», es una
prueba manual en un teléfono: queda para P- el día de la fusión). Batería: 496 tests, build,
`tsc` 128, F0–F6 todos en verde, baterías de servicios iguales que antes.


- [x] Planificación en tres densidades. **Se construye móvil primero**, no se adapta el
      escritorio después.
- [x] Reasignar, mover de fecha (D9), dividir un trabajo (D10).
- [x] Detección de conflictos **antes** de soltar, no después del error.

---

### BLOQUE 3 — Tickets más grandes
*La palanca de ingresos. Requiere los tres bloques anteriores.*

#### ✅ F7 — Varios trabajadores y varios días

**Diseño (2026-09-24), tras D11–D13.** Horas de trabajo del presupuesto = L (entero).
- **Si cabe en un día (L ≤ 12, o con varias personas):** se busca el equipo más pequeño (1 … el
  límite de la empresa) en el que cada persona trabaja a la vez desde la hora elegida;
  L = 6 con 2 personas = 3 h de reloj. Si no hay equipo y la empresa acepta trabajos partidos, por
  turnos (F6). **Un trabajo de 12 h o menos nunca se parte en varios días.**
- **Si no cabe en un día (L > 12):** varios días seguidos desde la fecha elegida (se saltan los
  días sin nadie libre), hasta 21 días. El primer día empieza a la hora elegida; los demás, cada
  persona desde su primera hora libre. Cada día trabajan hasta N personas, cada una sus horas
  libres seguidas (máx. 12, D13).
- **Modelo:** `bookings.end_date` (último día; nulo = un día), `bookings.labour_hours` (L) y
  `duration_hours` = lo que dura el primer día (sigue ≤ 12: los siete guardas de H-02 no se
  tocan). La agenda (`booking_blocks`) ya guarda día, hora y persona; pasa a admitir **varias
  personas en la misma hora** del mismo trabajo. El bloqueo del pago, igual.
- **Una sola regla para vender:** el mismo planificador decide las horas que ve el cliente (en la
  web) y las que se apartan al pagar (en la base de datos), y una prueba comprueba que coinciden.
- En trabajos de varias personas o días: alargar/acortar y «repartir por horas» no aplican; sí
  **cambiar una persona por otra** en todo el trabajo y mover de fecha (se vuelve a planificar).

Partes: **F7.1** servidor (modelo, planificador, pago, agenda) → **F7.2** motor de la web (horas
válidas con equipos y varios días, presupuesto con fecha de fin) → **F7.3** pantallas (reserva,
cliente, empresa, empleado, ajuste de la empresa).

**✅ F7.1 Servidor — hecho** (migración `20260925190000_empresas_f7_crew_multiday.sql`,
`verify-f7-server.mjs` 16/16). `companies.max_crew` (1–10, solo el dueño), `bookings.end_date` y
`bookings.labour_hours` (solo en trabajos de equipo o de varios días), agenda y bloqueo del pago
con varias personas en la misma hora. `plan_booking_cells()` es el planificador (A-40); el pago
aparta sus celdas y la confirmación las convierte en agenda. En trabajos de equipo o varios
días: ni alargar/acortar, ni repartir por horas, ni «todo a una persona»; sí
`replace_booking_worker` (A-41) y mover de fecha volviendo a planificar. Las agendas de empresa
y empleado incluyen trabajos que empezaron antes del rango, con las horas de cada día. El aviso
de «¿se hizo?» va tras el último día. Un autónomo también puede tener trabajos de varios días
(D12). F4–F6 siguen en verde. Pendiente: que la web los ofrezca (F7.2) y las pantallas (F7.3).

**✅ F7.2 Motor de la web — hecho** (`bookingEligibilityCore.ts`, `bookingQuoteCore.ts`,
`booking-authority`, `booking-payment`; `verify-f7-web.mjs` 8/8). `planBookingShape()` repite en
TypeScript la regla de `plan_booking_cells` (sin decidir quién va) y decide las horas que ve el
cliente; la franja del presupuesto lleva la forma del trabajo (`crew`, `endDate`, `labourHours`,
`planDays`). Se lee la agenda de los 20 días siguientes. **T7 deja de rechazar los trabajos de más de
12 h** (solo queda un tope de 250 h). Prueba de coherencia: con horarios al azar, en 72
combinaciones (límite 1–3, con y sin partidos, 2/8/18/36 h) la web ofrece exactamente las horas
en las que el pago encuentra plan. **H-32** encontrado y cerrado (la web perdía horas pasadas las
1000 filas). Baterías de servicios, iguales (H-27).

**✅ F7.3 Pantallas — hecho. F7 cerrada.** Reserva: al elegir hora, la web enseña la forma del
trabajo que manda el servidor por hora (`slotPlans`): «Del 29 de septiembre al 2 de octubre, desde
las 08:00 · Hasta 2 personas a la vez · 21 h de trabajo»; lo mismo en el resumen de pago. Cliente:
su tarjeta dice «del 29 de septiembre al 3 de octubre» o «8 h de trabajo en equipo», y el día antes
ve a todos los que van (F7-14). Empresa: ajuste «Personas a la vez» (1–10); la agenda pone cada
hora en su día, la lista dice «Luis y Ana a la vez» o las fechas, y la hoja de un trabajo de equipo
o de varios días enseña quién va cada día y «Cambiar» por persona (con «ocupado» antes de elegir).
Las listas de reservas y solicitudes no ofrecen «todo a una persona» ni cambiar la duración en
estos trabajos. Empleado: un trabajo de varios días sale en cada día que va, con sus horas de ese
día («Trabajo del 29 de septiembre al 3 de octubre · Vais 2 personas»); «He terminado», el último
día. Correos: «del … al …, desde las 08:00» y «Tu parte» por días. Recorrido completo en el
navegador (móvil, 375 px) con `seed-f7-demo.mjs`: dueña, empleado y clienta hasta el resumen de
pago (sin pagar: crearía un cobro en Stripe; el pago se prueba por el camino real en
`verify-f7-web`).

- [x] Personas a la vez (`companies.max_crew`, D11) y `bookings.end_date` (en lugar del
      `required_workers` del plan original: el número de personas lo decide el planificador,
      no se fija al vender).
- [x] **Duración** (lo que dura el primer día, sigue con tope 12 h: H-02 intacto) separada de
      **mano de obra** (`bookings.labour_hours`).
- [x] En la reserva y en el presupuesto.

#### 🟨 F8 — Multi-servicio

**Estado de partida (verificado 2026-09-24).** Hoy una reserva es de UN servicio en todo el
camino: la pantalla de servicios solo deja marcar uno (`ServicesPage.tsx:109`), el motor calcula
con la tarifa de un servicio (`bookingQuoteCore.ts:1149`, `buildAuthoritativeBookingQuote`), el
presupuesto (`booking_quotes.service_id`), el pago y la reserva (`bookings.service_id`, leída por
27 funciones SQL y 18 ficheros de la web). Queda un andamiaje antiguo aprovechable: los datos de
cada servicio del embudo ya se guardan por servicio (`servicesData`, `BookingContext.tsx:420`).

**Diseño (D14–D16 respondidas el 2026-09-24):**
- Una reserva puede llevar **varios servicios**: tabla `booking_items` (reserva, servicio, datos
  del cliente de ese servicio, precio, horas de trabajo, carnet). `bookings.service_id` se queda
  como el **primer** servicio (compatibilidad: autónomo con un servicio = exactamente lo de hoy,
  una fila en `booking_items`).
- **Precio:** cada servicio con **su** tarifa y **el mismo motor** (sin motor nuevo); el total es
  la suma y la comisión se calcula sobre el total, con un solo pago.
- **Tiempo:** los servicios se hacen en la misma visita, uno detrás de otro: las horas de trabajo
  se suman y el planificador de F7 decide equipo y días. Carnet: si algún servicio lo exige, lo
  exige el trabajo.
- **Embudo:** elegir varios servicios → rellenar los datos de cada uno (la pantalla de detalles
  que ya existe, una vez por servicio) → profesionales → hora → pago.
- **Después de reservar:** detalle por servicio para el profesional/empleado; el cambio de precio
  sigue siendo del total.

Partes: **F8.1** servidor (`booking_items`, personas que hacen todos los servicios, pago y
reserva con varios servicios) → **F8.2** motor de la web (presupuesto de varios servicios con
el mismo motor, lista de profesionales que hacen todos, revalidación del pago) → **F8.3**
embudo (elegir varios servicios y rellenar cada uno) → **F8.4** después de reservar (cliente,
profesional, empresa, empleado y correos con cada servicio).

**✅ F8.1 Servidor — hecho** (migración `20260926120000_empresas_f8_booking_items.sql`,
`verify-f8-server.mjs` 11/11). `booking_items` (lectura: cliente, proveedor, quien va y admin;
escritura solo del pago), `booking_quotes.items`, `provider_workers_all()` (quien hace TODOS los
servicios, D16), `provider_free_hours` y `plan_booking_cells` con servicios de más, y las
funciones de trabajos ya vendidos (repartir, cambiar persona, mover de fecha) miran todos los
servicios de la reserva (`booking_service_ids`). El pago rechaza presupuestos de varios
servicios que no cuadran y escribe una fila por servicio (una, si es un servicio). Carnet: si
un servicio lo exige, lo exige el trabajo. F4–F7 siguen en verde.

**✅ F8.2 Motor de la web — hecho** (`bookingQuoteCore.ts`, `bookingEligibilityCore.ts`,
`booking-authority`, `booking-payment`; `verify-f8-web.mjs` 8/8). La web acepta `items` (varios
servicios, el primero el principal). `buildAuthoritativeMultiServiceQuote` **no es un motor
nuevo**: calcula cada servicio con `buildAuthoritativeBookingQuote` y su tarifa, suma precio y
horas y pone los gastos de gestión sobre el total (césped 54 € + setos 220 € = 274 €, gestión
34,25 €). Solo salen los profesionales con tarifa para todos (D15) y con personas que los hagan
todos (D16). El presupuesto guarda `items` y los datos de todos juntos (el profesional ve las
zonas de cada servicio). La «versión de tarifas» firmada la calculan web y pago con la misma
función (`providerConfigVersionPayload`). Un servicio: todo exactamente igual (sin `items`).
Coherencia web ↔ pago también con varios servicios. Baterías de servicios: iguales o mejor
(fitosanitarios 77/1, antes 76/2: lo arregló la tarea aparte de H-27, no esta fase).

- [ ] `booking_items`. Afecta también a los autónomos: es evolución de producto.

#### ⬜ F9 — Mantenimiento de jardín

- [ ] Se construye sobre `booking_items`. **Sin motor de precios nuevo.**

---

## 4. Registro de avance

Una fila por sesión de trabajo. Se añade al **cerrar**, con lo que pasó de verdad.

| Fecha | Fase | Qué se hizo | Tests | Commit |
|---|---|---|---|---|
| 2026-09-20 | — | Auditoría, arquitectura y plan. Sin código. | 462 ✅ | `1486dde` |
| 2026-09-23 | — | Documentos llevados a `feat/garser-empresas` sobre `origin/main` (#34). Hallazgos y línea base revalidados: tests igual, `tsc` 172→130. MCP de Supabase conecta al local. Sin código. | 462 ✅ | `3e6d84b` |
| 2026-09-23 | — | Respuestas del usuario a D1–D6 incorporadas al plan, hallazgos y pruebas. Nueva pendiente D7. Sin código. | 462 ✅ | `a1fa702` |
| 2026-09-23 | — | D4 precisada, D7 aplazada a F3, política «todo en local hasta el final» (§0, §6). Sin código. | 462 ✅ | `2e94af9` |
| 2026-09-23 | F0 | Entorno local montado desde esta carpeta (BD reconstruida: tenía una migración ajena). Investigación de F0: **escalada a admin reproducida** (H-11), nada crea perfiles (H-12). F0 rediseñada. Sin código. | 462 ✅ | `845d4bc` |
| 2026-09-23 | F0 | **Parte servidor hecha.** Migración de perfil al registrarse + cierre de H-11 + arreglo de H-15. Seed adaptado. Verificación 7/7 (1/7 antes de la migración), `db reset` desde cero limpio, relleno probado en transacción. | 462 ✅ · build ✅ · tsc 130 | `fc37a8d` |
| 2026-09-23 | F0 | **Parte frontend hecha. F0 cerrada.** `AccountContext` + `useAccount()`, todas las deducciones de rol sustituidas, `RoleMonitor` reconvertido, `BottomNav` arreglado (H-16). 11 pruebas nuevas. Recorrido completo en navegador. | 473 ✅ · build ✅ · tsc 129 · lint 0 | `fa7527c` |
| 2026-09-24 | F7 | **Equipos y varios días. F7 cerrada.** D11–D13 del usuario. Un solo planificador en SQL (pago) y en TypeScript (web) con prueba de coherencia (A-40); equipos a la vez con límite de la empresa; trabajos de varios días también para autónomos (T7 deja de rechazarlos); cambiar una persona por otra (A-41); pantallas de reserva, cliente, empresa y empleado, y correos. **H-32** (la web perdía horas pasadas 1000 filas) cerrado. Recorrido en el navegador. | 513 ✅ · build ✅ · tsc 128 · F7 16+10 · F6 12+9 · F5 29 · F4 21 · F3 35+10 · F2 18 · F1 13 · F0 7 · servicios = H-27 | `d1b8a52` `78f1c01` + (este) |
| 2026-09-24 | F6 | **Planificación. F6 cerrada.** Hito hecho por el chat en el navegador; D9 y D10 del usuario. Una persona por hora en todo el camino del dinero (A-37), trabajos partidos opcionales (A-38), planificador móvil Día/Semana/Lista con conflictos antes de guardar, mover de fecha con propuesta al cliente (A-39). F6-06 con 20 personas a 375 px. | 496 ✅ · build ✅ · tsc 128 · F6 12+9 · F5 29 · F4 21 · F3 35+10 · F2 18 · F1 13 · F0 7 | `4267220` `ecb0436` + (este) |
| 2026-09-24 | F5 | **Asignar y ejecutar. F5 cerrada.** Horarios del equipo (H-29: una hora vendida ya no se puede reabrir; el dueño que trabaja no pierde sus horas), asignación en el servidor con mínimo privilegio (A-33, A-34), panel del empleado Hoy/Semana/Perfil, «cambiar quién va», avisos por correo, D6 (A-35). Imprevistos H-30 (bucle de pintado, afecta a autónomos) y H-31 (nombre del dueño en lugar del de la empresa) cerrados. | 493 ✅ · build ✅ · tsc 129 · F5 9+13+7 · F4 21/21 · F3 35/35 · correos 10/10 · F2 18/18 · F1 13/13 · F0 7/7 | `fd4f9c7` `6fc3d62` `55db2fa` `b502fb4` |
| 2026-09-24 | F4 | **La empresa vende. F4 cerrada.** H-26 → decisión del usuario: se aparta a una persona al vender; el dueño elige si es definitiva o propuesta. Fuente única de horas libres para web y pago. Web: distintivo, solicitudes y reservas de la empresa con «quién va», opción de asignación. Recorrido de punta a punta en el navegador (móvil). H-27 (fallos antiguos de las baterías, tarea aparte) y H-28 anotados. | 491 ✅ · build ✅ · tsc 129 · F4 21/21 · correos 10/10 · F3 35/35 · F2 18/18 · F1 13/13 · F0 7/7 | `9e42bc0` `74893e3` |
| 2026-09-24 | F3.4 | **Correos de empresas. F3 cerrada.** Invitación (una vez, con token verificado, tope diario), empresa aprobada y rechazada (solo admin, estado comprobado). Probado por la API (10/10) y desde la web en móvil. | 486 ✅ · build ✅ · tsc 129 · correos 10/10 · F3 35/35 · F2 18/18 · F1 13/13 · F0 7/7 | `2a37528` |
| 2026-09-24 | F3.3 | **Panel de empresa, invitación y panel de empleado.** Recorrido completo en navegador (móvil): invitar → abrir sin cuenta → registrarse → volver por la portada → aceptar → datos → carnet → admin lo aprueba → la empresa asigna servicios. Configuración de precios de la empresa adelantada de F4. **H-23, H-24, H-25** encontrados y cerrados. | 486 ✅ · build ✅ · tsc 129 · F3 35/35 · F2 18/18 · F1 13/13 · F0 7/7 | `0987904` |
| 2026-09-24 | F3.2 | **Web del alta de empresas.** Registro, encuesta de 5 pasos, estado, revisión en el admin. Recorrido completo en navegador (móvil): alta → encuesta → envío → aprobación → panel; y rechazo → motivo → corregir → reenvío. Sin regresiones de jardinero ni cliente. | 481 ✅ · build ✅ · tsc 129 · F3 31/31 · F2 18/18 · F1 13/13 · F0 7/7 | `bdc0c8b` |
| 2026-09-24 | F3.1 | **Servidor del alta de empresas y empleados.** Solicitud y revisión, invitaciones atadas a correo con token hasheado, equipo, carnet por persona. **H-22 descubierto y cerrado** (licencias creadas ya aprobadas). | 473 ✅ · build ✅ · tsc 129 · F3 31/31 · F2 18/18 · F1 13/13 · F0 7/7 | `f7ec1d5` |
| 2026-09-24 | F2 | **F2 cerrada.** Modelo de proveedor y empresas con RLS de solo lectura e integridad en la BD. **H-21 (crítico) descubierto y cerrado:** cualquiera se daba de alta como jardinero reservable con carnet falso, y un jardinero se aprobaba el carnet. | 473 ✅ · build ✅ · tsc 129 · F2 18/18 · F1 13/13 · F0 7/7 | `b0a6fbe` |
| 2026-09-23 | F1 | **F1 cerrada.** Registro de capacidad con `assignee_id` + índice único. Descubiertos y resueltos H-17 (cinco escritoras, no tres), H-18 (`ON CONFLICT` sin destino), H-19 (doble venta posible hoy) y H-01 (dos fuentes de disponibilidad, fallo real). Migración probada sobre datos existentes y desde cero. | 473 ✅ · build ✅ · tsc 129 · F1 13/13 · F0 7/7 | `c506f1e` |

---

## 5. Notas para el usuario: lo que tendrás que hacer al terminar

> **Hasta ahora no has hecho ninguna acción manual, y no hace falta.** El proyecto vive en tu
> ordenador hasta el final (§0): todo lo que cada fase dice como «acción manual» se apunta
> **aquí** y se hace **una sola vez, el día de la fusión con garser.es**. Cada fase nueva añade
> sus puntos a esta lista. El detalle técnico de cada punto está en §6.

**Antes de fusionar — comprobar producción (solo lectura, SQL Editor de Supabase):**

1. ¿Hay algún administrador que no seas tú? → consulta 1 de §5b. *(F0)*
2. ¿Hay horas vendidas dos veces o bloques sin reserva? → consultas de F1 en §6. *(F1)*
3. ¿Hay fichas de jardinero sin solicitud aprobada, o carnets aprobados sin revisión? →
   consultas de F2 en §6. *(F2)*
4. ¿Hay licencias aprobadas que nadie revisó? → consulta de F3 en §6. *(F3)*

Si alguna devuelve filas, se revisa antes de seguir (lo haremos juntos).

**El día de la fusión — en este orden:**

5. Traer a la rama lo que haya entrado en `main` mientras tanto.
6. Aplicar las migraciones del proyecto, **en este orden**:
   `20260923120000` (F0) → `20260923130000` (F1) → `20260924120000` (F2) →
   `20260924130000` → `20260924140000` → `20260924150000` → `20260924160000` (F3) →
   `20260925120000` (F4) → `20260925130000` (F5.1) → `20260925140000` (F5.2) →
   `20260925150000` (F5.4) → `20260925160000` (F6.1) → `20260925170000` (F6.2) →
   `20260925180000` (F6.3) → `20260925190000` (F7.1) → `20260926120000` (F8.1)
   *(las fases siguientes añadirán las suyas al final)*.
7. Desplegar las funciones que han cambiado:
   `supabase functions deploy send-email-notification --use-api` *(F3)*,
   `supabase functions deploy booking-authority --use-api` y
   `supabase functions deploy booking-payment --use-api` *(F4: las dos, a la vez que la
   migración de F4; con una sin la otra, el pago y la web no se entienden)*.
   `send-email-notification` se despliega una sola vez con todo lo de F3, F5.4 y F7.
   `supabase functions deploy booking-confirmation-email --use-api` *(F7: usa el texto nuevo
   de fechas de los trabajos de varios días; sin redesplegar, diría solo el primer día)*.
8. Desplegar la web (Vercel) desde la rama fusionada.

**Justo después — probar en garser.es:** la batería «P-» de `03-PRUEBAS.md` §3, de arriba
abajo. Las más importantes: **P-F1-1** (un pago real crea bien la agenda), **P-F3-6** (una
invitación real llega y se acepta) y **P-F3-9 a P-F3-11** (llegan los correos).

**Si antes de terminar garser.es recibe usuarios reales**, los puntos 1 y la migración de F0
(escalada a administrador, H-11) se adelantan (D8).

---

## 5b. Consulta para el usuario en producción (solo lectura)

Para cerrar el diseño de F0 y medir el alcance de H-11. Se ejecuta en el **SQL Editor del
panel de Supabase de producción**. Son tres `SELECT`: no modifican nada.

```sql
-- 1) Administradores que existen. Solo debería salir el tuyo.
select u.email, p.created_at
from public.profiles p join auth.users u on u.id = p.user_id
where p.role = 'admin'
order by p.created_at;

-- 2) Usuarios registrados que NO tienen perfil (H-12).
select count(*) as usuarios_sin_perfil
from auth.users u
where not exists (select 1 from public.profiles p where p.user_id = u.id);

-- 3) Disparadores sobre auth.users en producción (¿hay alguno creado a mano?).
select tgname, tgfoid::regproc as funcion
from pg_trigger
where tgrelid = 'auth.users'::regclass and not tgisinternal;
```

---

## 6. Pendiente para el día de la fusión con producción

Se acumula fase a fase. Es la lista de lo que habrá que hacer en `garser.es` al fusionar.

| Fase | Qué | Notas |
|---|---|---|
| F0 | **Aplicar `20260923120000_empresas_f0_profile_on_signup.sql` cierra H-11** (escalada a admin) y arregla el alta del correo corporativo (H-15). Antes, ejecutar la consulta 1 de §5b: si aparece algún admin que no sea el del usuario, retirarlo | Si `garser.es` recibe usuarios reales antes de la fusión, adelantar esto (D8) |
| F1 | Consultar solapes en `booking_blocks` de producción **antes** de aplicar la migración | Si los hay, son dobles reservas reales: resolver a mano primero. La migración ya se niega a correr si los hay, pero conviene saberlo antes. Consulta abajo |
| F1 | Consultar bloques sin reserva o sin proveedor | Misma razón: la migración se detendría. Consulta abajo |
| F1 | Aplicar `20260923130000_empresas_f1_capacity_ledger.sql` **después** de la de F0 | Cambia `confirm_booking_payment_attempt`: el camino de todos los pagos. Probar P-F1-1 justo después |

| F2 | **Aplicar `20260924120000_empresas_f2_provider_model.sql` cierra H-21** (alta de jardineros sin aprobación y autoaprobación del carnet) | Antes, ejecutar las consultas de F2 de abajo: si hay fichas de proveedor sin solicitud aprobada, o carnets aprobados sin revisión, revisarlos a mano |

| F3 | **Aplicar `20260924130000_empresas_f3_onboarding_server.sql` cierra H-22** | Antes, la consulta de F3 de abajo: licencias aprobadas sin revisor |
| F3 | Aplicar `20260924140000`, `20260924150000` y `20260924160000` (en ese orden, tras la anterior) | Sin consulta previa: añaden funciones y una columna |
| F7.1 | Aplicar `20260925190000` **junto con** el despliegue de `booking-authority` y `booking-payment` (F7.2) | El pago pasa a apartar lo que decide el planificador (equipos, varios días). Para trabajos normales no cambia nada; justo después, P-F1-1 (un pago real de autónomo) |
| F6.1 | Aplicar `20260925160000` **y redesplegar a la vez** `booking-authority`, `booking-payment` y `send-email-notification` | El pago y la confirmación pasan a trabajar por horas. Justo después: P-F1-1 (un pago real de autónomo) |
| F5.1 | Aplicar `20260925130000` | Corrige de paso las horas que estén vendidas y marcadas libres (debería haber 0). Probar P-F5-1 |
| F4 | Aplicar `20260925120000` **y en el mismo momento** desplegar `booking-authority` y `booking-payment` | Las funciones nuevas llaman a `provider_free_hours`, que crea la migración. Justo después: P-F1-1 (un pago real de autónomo) y P-F4-1 |
| F3 | **Desplegar `send-email-notification`** (`supabase functions deploy send-email-notification --use-api`) | Sin esto, invitar funciona pero no sale el correo (la web lo dice y da el enlace). Probar P-F3-9 a P-F3-11 |

**Consulta previa de F3 (solo lectura):**

```sql
-- Licencias en estado aprobado que nadie revisó (posible H-22). Debe dar 0 filas.
select id, gardener_id, license_number, expires_at
from public.gardener_licenses
where status = 'approved' and reviewed_by is null;
```

**Consultas previas de F2 (solo lectura):**

```sql
-- Fichas de proveedor sin solicitud aprobada detrás (posibles altas por H-21a)
select gp.user_id, gp.full_name, gp.created_at
from public.gardener_profiles gp
where not exists (select 1 from public.gardener_applications a
                  where a.user_id = gp.user_id and a.status = 'approved');

-- Carnets marcados como aprobados sin licencia revisada detrás (posible H-21b).
-- review_gardener_license deja la licencia en 'approved': un carnet legítimo no sale aquí.
-- En LOCAL sale el jardinero de la semilla (seed.sql marca el carnet sin crear licencia): esperado.
select gp.user_id, gp.full_name
from public.gardener_profiles gp
where gp.license_verification_status = 'approved'
  and not exists (select 1 from public.gardener_licenses l
                  where l.gardener_id = gp.user_id and l.status = 'approved');
```

**Consultas previas de F1 (solo lectura, SQL Editor de producción):**

```sql
-- Horas vendidas dos veces a la misma persona (debe dar 0 filas)
select b.gardener_id, bb.date, bb.hour_block, count(*)
from public.booking_blocks bb join public.bookings b on b.id = bb.booking_id
group by 1, 2, 3 having count(*) > 1;

-- Bloques sin reserva o sin proveedor (debe dar 0)
select count(*) from public.booking_blocks bb
left join public.bookings b on b.id = bb.booking_id
where b.gardener_id is null;
```
| — | Traer a esta rama lo que haya entrado en `main` | Ver §0 |

### Cambios que notarán los usuarios reales al fusionar (por F0)

Estaban programados desde antes pero no funcionaban en producción porque los usuarios no
tenían perfil (H-12). Con F0 empiezan a funcionar:

1. **Móvil, barra inferior:** los jardineros verán «Panel» en vez de «Inicio» (H-16).
2. **Menú superior oculto a jardineros pendientes de aprobación** (`Navbar.tsx`,
   `shouldHideNav`). La regla existía, pero nunca se cumplía.
3. **Al aprobar un jardinero, su perfil pasa a `gardener`** (`admin_review_gardener_application`):
   antes el `UPDATE` no encontraba fila.

### Cambios que notarán los usuarios reales al fusionar (por F1)

1. **Los jardineros podrán aceptar y alargar servicios en horas que la web ya ofrecía como
   libres**, aunque esos días estén fuera de la ventana del generador nocturno (H-01). Hoy les
   decía que no tenían horas libres.
2. **Si alguna vez la disponibilidad se desincroniza, un segundo pago por la misma hora ya no
   crea una doble reserva:** queda en `reconciliation_required` para conciliar (H-19).
