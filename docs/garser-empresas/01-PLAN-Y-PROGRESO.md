# GarSer Empresas — Plan de implementación y progreso

> **Este fichero es el estado real del proyecto.** Si tu memoria o tu resumen de contexto
> dicen otra cosa, gana este fichero. Se actualiza al cerrar cada fase, no al empezarla.
>
> Antes de tocarlo, lee `00-GUIA-DEL-CHAT.md`.

**Estado global:** Fase 0 no empezada · Diseño cerrado · Sin código escrito
**Última actualización:** 2026-09-23
**Línea base de tests:** 462 en verde / 68 ficheros

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

## 2. Decisiones pendientes del usuario

No las decida el chat. Están bloqueando lo que se indica en cada fila.

| # | Decisión | Bloquea | Por qué importa |
|---|---|---|---|
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

#### ⬜ F0 — Una sola fuente de verdad para el rol

**Problema.** Hoy el tipo de cuenta se deduce de cinco sitios a la vez: `user_metadata.role`,
`user_metadata.requested_role`, `localStorage.signup_role`, `profiles.role`, la existencia de
`gardener_profiles` y el estado de `gardener_applications`. Hay 8 apariciones en `App.tsx` y
más en `AuthForm.tsx`. Una de esas fuentes (`localStorage`) la controla el cliente.

**Trabajo.**
- [ ] Hook `useAccount()`: resuelve el tipo de cuenta desde `profiles.role` y nada más.
- [ ] Sustituir las 8 resoluciones de `App.tsx` y las de `AuthForm.tsx`.
- [ ] Eliminar `localStorage.signup_role` y las lecturas de `user_metadata` para rol.
- [ ] `CHECK` en `profiles.role` con los 5 valores + `REVOKE UPDATE (role)` a `authenticated`.

**Criterio de cierre.** Cero cambios visibles. 462 tests siguen en verde. Un cliente sigue
yendo a su panel, un autónomo al suyo, un admin al suyo, y los estados de solicitud
(pendiente/denegada/activa) siguen redirigiendo igual.

**Riesgo.** Alto: es la lógica que decide qué ve cada usuario al entrar. Se prueba con las
cuatro cuentas sembradas antes de cerrar.

---

#### ⬜ F1 — El registro de capacidad

**Problema.** `booking_blocks(booking_id, date, hour_block)` no sabe **quién** trabaja: se
deduce de `bookings.gardener_id`. Mientras el trabajo lo haga una persona funciona; en cuanto
lo ejecutan dos empleados, o se reparte en varios días, el modelo no puede representarlo.

**Trabajo.**
- [ ] `ALTER TABLE booking_blocks ADD COLUMN assignee_id uuid` + relleno desde
      `bookings.gardener_id` + `SET NOT NULL`.
- [ ] `CREATE UNIQUE INDEX (assignee_id, date, hour_block)` — la doble reserva pasa a ser
      imposible por esquema, no por procedimiento.
- [ ] Actualizar las **tres** funciones que escriben la agenda:
      `reserve_booking_schedule()`, `release_booking_schedule()` y
      **`resize_booking_schedule()`** (esta última es nueva, de la migración `20260913121000`).
- [ ] Resolver el destino de `availability_blocks` — ver hallazgo **H-01**.
- [ ] Actualizar `BookingRequestsManager.tsx`, único fichero de frontend que lee la tabla.

**Criterio de cierre.** Una reserva de autónomo se crea, se redimensiona y se cancela
exactamente igual que antes. 462 tests en verde. Comprobación explícita de que no quedan
`assignee_id` a `NULL`.

**Riesgo.** Crítico. Es el punto de no retorno del proyecto. **Antes de migrar** hay que
consultar si existen solapes en producción: si el índice único falla al crearse, son dobles
reservas reales que hay que resolver a mano.

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

- [ ] Registro «Tengo una empresa de jardinería» en `AuthForm`. *(Depende de D2.)*
- [ ] Invitación por token: se guarda **el hash**, nunca el token.
- [ ] Email de invitación — tipo nuevo en el despachador Brevo existente.
- [ ] RPC `accept_company_invitation(token)`: deriva `company_id` **del token**, jamás de un
      parámetro. Rechaza si quien acepta ya tiene `gardener_profiles`.
- [ ] Panel de empresa mínimo: perfil y equipo.

**Criterio de cierre.** Una empresa con un empleado existe y ambos entran a su panel.
Probado el vector de suplantación de `company_id`.

---

#### ⬜ F4 — La empresa vende

- [ ] Vista `provider_free_hours` sobre la tabla de disponibilidad que quede tras H-01.
- [ ] `booking-authority` lee capacidad (`free_count`) en vez de disponibilidad binaria.
      **Recordatorio: esta función importa `bookingQuoteCore.ts` → hay que redesplegarla.**
- [ ] La empresa configura precios con los configuradores existentes, sin tocarlos.
- [ ] La empresa aparece en `ProvidersPage` con distintivo discreto. *(Depende de D1, D3.)*

**Criterio de cierre.** **Primera reserva a una empresa, de punta a punta**, incluida la
comisión por Stripe. Verificado en paralelo que el funnel del autónomo no ha cambiado.

> ### ⏸ HITO — Piloto con una empresa real
> No se sigue a la Fase 5 hasta que una empresa real haya completado una reserva real.
> Lo que se aprenda ahí manda sobre el diseño del planificador.

---

### BLOQUE 2 — Una empresa puede operar
*Retención de la oferta que se acaba de captar.*

#### ⬜ F5 — Asignar y ejecutar

- [ ] Asignación mínima: el dueño elige empleado de una lista de quién está libre.
- [ ] Extender `shares_booking_with()` con la vía «estoy asignado» — es lo que deja al
      empleado ver la dirección del trabajo. Mínimo privilegio: **asignado**, no *de la empresa*.
- [ ] Panel de empleado: Hoy / Mi semana / Mi disponibilidad / Perfil.
- [ ] Emails de asignación y de cambio.
- [ ] Puerta de carnet fitosanitario en la asignación. *(Depende de D4 — ver H-04.)*

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
| 2026-09-23 | — | Documentos llevados a `feat/garser-empresas` sobre `origin/main` (#34). Hallazgos y línea base revalidados: tests igual, `tsc` 172→130. MCP de Supabase conecta al local. Sin código. | 462 ✅ | (este) |

---

## 5. Acciones manuales del usuario

*(nada que desplegar — esta entrega es solo documentación)*

Pendientes para cuando arranque la Fase 0:

1. ~~Crear la rama~~ → hecho: `feat/garser-empresas` desde `origin/main` (2026-09-23).
2. **Consultar solapes en `booking_blocks` de producción** antes de la F1 (ver prueba F1-00).
   El MCP de Supabase conecta, pero solo al local: esta consulta hay que hacerla desde el
   panel de Supabase de producción.
3. **Responder D1 y D2**, que bloquean las fases 3 y 4.
