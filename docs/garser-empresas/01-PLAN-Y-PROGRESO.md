# GarSer Empresas — Plan de implementación y progreso

> **Este fichero es el estado real del proyecto.** Si tu memoria o tu resumen de contexto
> dicen otra cosa, gana este fichero. Se actualiza al cerrar cada fase, no al empezarla.
>
> Antes de tocarlo, lee `00-GUIA-DEL-CHAT.md`.

**Estado global:** ✅ F0 y ✅ F1 cerradas (2026-09-23) · BLOQUE 0 (cimientos) terminado · siguiente: F2 — el proveedor como concepto
**Última actualización:** 2026-09-23
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

> **D4, precisión confirmada por el usuario (2026-09-23):** el carnet se exige **solo a los
> empleados que ofertan servicios fitosanitarios**. Sin su carnet adjuntado y aprobado no se
> les puede activar ese servicio ni asignarles esos trabajos. A quien no hace fitosanitarios
> no se le pide.

### Pendiente

| # | Pregunta | Bloquea | Por qué |
|---|---|---|---|
| D8 | ~~¿Se arregla H-11 ya en producción?~~ | — | **Respondida (2026-09-23): no es urgente**, `garser.es` aún no tiene usuarios reales. Se arregla con F0 el día de la fusión (§6). **Si antes de la fusión entran usuarios reales, esta decisión debe revisarse.** |
| D7 | **¿Qué preguntas lleva la encuesta de alta de empresas?** | F3 | Sale de D2. **Decisión del usuario (2026-09-23): se diseña el formulario al llegar a la F3**, adaptado a lo que GarSer necesita saber de una empresa. No bloquea nada antes. |

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

#### ⬜ F2 — El proveedor como concepto

- [ ] `gardener_profiles.provider_kind` (`'solo'` | `'company'`), `DEFAULT 'solo'`.
- [ ] `COMMENT ON COLUMN bookings.gardener_id`: pasa a significar *proveedor responsable*.
- [ ] Tablas `companies`, `company_members`, `company_invitations`.
- [ ] Funciones `my_company_id()`, `is_company_owner()` — **`SECURITY DEFINER`**, para no
      provocar recursión de policies.
- [ ] Policies RLS de las tres tablas.

**Criterio de cierre.** Todo lo existente queda como `'solo'` y se comporta igual. Las RLS se
prueban con dos empresas sembradas, contra la API, no contra la interfaz.

---

#### ⬜ F3 — Alta de empresa y de empleados

- [ ] Registro «Tengo una empresa de jardinería» en `AuthForm`.
- [ ] **Solicitud de alta de empresa propia** (D2): encuesta de empresa (preguntas de D7),
      tabla separada de `gardener_applications`, y su revisión en el panel de admin. Hasta que
      el admin la aprueba, la empresa no aparece en el funnel.
- [ ] Interruptor del dueño «Yo también trabajo» (D3).
- [ ] Alta de empleado con **selección de servicios** (D5). Solo se pueden marcar servicios
      que la empresa tiene activos.
- [ ] **Carnet fitosanitario por empleado** (D4): subida del carnet en la ficha del empleado,
      aprobación por el admin, y sin carnet aprobado no se le puede activar ese servicio.
- [ ] Invitación por token: se guarda **el hash**, nunca el token.
- [ ] Email de invitación — tipo nuevo en el despachador Brevo existente.
- [ ] RPC `accept_company_invitation(token)`: deriva `company_id` **del token**, jamás de un
      parámetro. Rechaza si quien acepta ya tiene `gardener_profiles`.
- [ ] Panel de empresa mínimo: perfil y equipo.

**Criterio de cierre.** Una empresa aprobada por el admin, con un empleado con servicios
asignados, existe y ambos entran a su panel. Probado el vector de suplantación de
`company_id`.

---

#### ⬜ F4 — La empresa vende

- [ ] Vista `provider_free_hours` sobre la tabla de disponibilidad que quede tras H-01,
      **calculada por servicio** (D5): una empresa solo tiene hueco para el servicio X si hay
      libre un empleado que hace el servicio X. El dueño cuenta solo si trabaja (D3).
- [ ] `booking-authority` lee capacidad (`free_count`) en vez de disponibilidad binaria.
      **Recordatorio: esta función importa `bookingQuoteCore.ts` → hay que redesplegarla.**
- [ ] La empresa configura precios con los configuradores existentes, sin tocarlos.
- [ ] La empresa aparece en `ProvidersPage` con distintivo discreto. Comisión 12,5 % (D1).

**Criterio de cierre.** **Primera reserva a una empresa, de punta a punta**, incluida la
comisión por Stripe. Verificado en paralelo que el funnel del autónomo no ha cambiado.

> ### ⏸ HITO — Recorrido completo en local, con el usuario haciendo de empresa
> Como el proyecto no sale a producción hasta el final (§0), el piloto con una empresa real
> no es posible aquí. En su lugar: **el usuario recorre en local el camino entero de una
> empresa** — alta, aprobación, empleados, precios, recibir una reserva — antes de construir
> el planificador. Lo que se aprenda ahí manda sobre el diseño de F5 y F6.
>
> El piloto con una empresa real pasa a ser el **primer paso después de la fusión**.

---

### BLOQUE 2 — Una empresa puede operar
*Retención de la oferta que se acaba de captar.*

#### ⬜ F5 — Asignar y ejecutar

- [ ] Asignación mínima: el dueño elige empleado de una lista de quién está libre **y hace
      ese servicio** (D5). En trabajos fitosanitarios, solo quien tiene carnet aprobado (D4).
- [ ] Extender `shares_booking_with()` con la vía «estoy asignado» — es lo que deja al
      empleado ver la dirección del trabajo. Mínimo privilegio: **asignado**, no *de la empresa*.
- [ ] Panel de empleado: Hoy / Mi semana / Mi disponibilidad / Perfil.
- [ ] Emails de asignación y de cambio.
- [ ] Puerta de carnet fitosanitario en la asignación, **por empleado** (D4, H-04).
- [ ] El cliente ve nombre y foto de quién va, **el día antes** (D6).

#### ⬜ F6 — Planificación y reasignación

- [ ] Planificación en tres densidades. **Se construye móvil primero**, no se adapta el
      escritorio después.
- [ ] Reasignar, mover de fecha, dividir un trabajo.
- [ ] Detección de conflictos **antes** de soltar, no después del error.

---

### BLOQUE 3 — Tickets más grandes
*La palanca de ingresos. Requiere los tres bloques anteriores.*

#### ⬜ F7 — Varios trabajadores y varios días

- [ ] `bookings.required_workers` (`DEFAULT 1`) y `bookings.end_date` (`DEFAULT NULL`).
- [ ] Separar **duración** (span de la jornada, sigue con tope 12 h) de **mano de obra**
      (total, sin tope). Ver hallazgo **H-02**: así los 7 guardas de 12 h siguen siendo
      válidos y no hay que levantarlos.
- [ ] Exponerlo en el funnel y en el presupuesto.

#### ⬜ F8 — Multi-servicio

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
| 2026-09-23 | F1 | **F1 cerrada.** Registro de capacidad con `assignee_id` + índice único. Descubiertos y resueltos H-17 (cinco escritoras, no tres), H-18 (`ON CONFLICT` sin destino), H-19 (doble venta posible hoy) y H-01 (dos fuentes de disponibilidad, fallo real). Migración probada sobre datos existentes y desde cero. | 473 ✅ · build ✅ · tsc 129 · F1 13/13 · F0 7/7 | (este) |

---

## 5. Acciones manuales del usuario

*(nada que desplegar — esta entrega es solo documentación)*

Pendientes para cuando arranque la Fase 0:

1. ~~Crear la rama~~ → hecho: `feat/garser-empresas` desde `origin/main` (2026-09-23).
2. **Consultar solapes en `booking_blocks` de producción** — ya no antes de la F1, sino
   **antes de la fusión final**, que es cuando la migración llegará a producción (ver prueba
   F1-00). Se hace desde el panel de Supabase de producción.
3. ~~Responder D1–D6~~ → respondidas el 2026-09-23.
4. **D7** (encuesta de empresas): se diseña juntos al llegar a la F3.

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
