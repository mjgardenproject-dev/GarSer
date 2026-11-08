# 08 — Cuenta de profesional única y dinámica (de autónomo a equipo)

> **Estado: EJECUTADO y verificado en local (2026-11-08); falta que el usuario lo lleve a producción (§9, §11).** El usuario respondió
> **D35 = autoservicio con declaración de seguro** y dio el OK para ejecutar §6. Hechas F-A a F-G. El diseño de §1–§9 no cambió; lo que
> cambió al ejecutar está en §10 y el cierre (qué se verificó y qué no) en §11.
> Rama: `feat/cuenta-profesional-dinamica`, creada desde `origin/main` `8ab9b98` (la PR #76
> `auditoria/ux-movil-onboarding-profesional` ya estaba fusionada, con squash). Antes de
> tocar nada, lee `00-GUIA-DEL-CHAT.md`.

## 0. Resumen

Hoy el tipo de cuenta se elige al registrarse y **no cambia nunca**: «Jardinero» (`profiles.role =
gardener`) o «Empresa» (`company`), con dos altas distintas. La propuesta:

- **Un solo registro «Profesional»** (`role = gardener` para todos). `company` deja de asignarse.
- **El modo no se elige: se deriva del servidor.** Modo equipo ⟺ hay al menos un empleado activo.
  Modo individual en cualquier otro caso. Lo lleva un único hook, `useProviderMode()`.
- **Promoción en sitio** (opción A del §4.3): al invitar al primer compañero, una RPC crea la
  empresa y el miembro dueño **sobre la ficha que ya existe**. Nada se mueve: `bookings.gardener_id`,
  reseñas, enlace, tarifas, carnet y horario cuelgan del mismo `user_id` antes y después.
- **Reversible sin borrar nada:** al irse el último empleado, la empresa queda latente y vuelve el
  modo individual. Los ajustes propios de empresa vuelven a su valor de fábrica.
- Casi todo el motor SQL **ya decide con `provider_kind`** (un solo discriminador). Por eso la
  pieza central es pequeña: un disparador que mantiene `provider_kind` a partir de los empleados.
  Eso evita reescribir ~10 funciones SQL y dos Edge Functions del motor de reserva (fuera de alcance).

## 1. Arranque (R1: qué se ha comprobado y cómo)

| Comprobación | Resultado |
|---|---|
| Rama de partida | `main` (`8ab9b98`) contiene la PR #76 (`gh pr view 76`: MERGED, 2026-11-05). `git diff HEAD origin/main` vacío. Rama nueva sin upstream (para no empujar por error). |
| `git status --short` | Solo `?? campaign/` (assets de la campaña Meta, anteriores a esta tarea, nunca commiteados). **No es mío ni se toca.** No bloquea: solo se añaden ficheros concretos (R5). |
| Línea base | `npm test`: **2824 en verde / 185 ficheros** (21 s). La anotada en `01` (953 / 118) estaba desfasada. `tsc` no se usa como señal. |
| Supabase local | Levantado desde esta carpeta: 160 migraciones aplicadas = 160 ficheros. |
| Baterías | Hoy hay 28 `verify-*.mjs` en `scripts/garser-empresas/` (`01` anota 27 / 300; la nueva es `verify-application-ads-consent`). |

**Cómo se hizo la auditoría.** Cuatro exploradores de solo lectura (BD · registro y redirecciones ·
paneles y menús · Edge Functions, correos y baterías). Yo **releí** las líneas que deciden el diseño y
las cito sin marca; las que vienen solo de los exploradores llevan «(aud.)».

## 2. Fase 1 — Diagnóstico

### 2.1 Hallazgos que condicionan el diseño

1. **El tipo vive en tres sitios que hoy nacen juntos y nada mantiene a la vez:** `profiles.role`
   (rutas y menús), `gardener_profiles.provider_kind` (SQL, Edge Functions, distintivo) y la fila
   `companies` + `company_members(owner)`. La prueba F2-01 solo vigila la coherencia
   (`scripts/garser-empresas/verify-f2-db.mjs:105-117`).
2. **No existe ninguna RPC de autónomo → empresa.** `self_declare_signup_role` solo convierte desde
   `client` sin actividad (`20261104160000_account_type_declaration_status.sql:39-59`);
   `admin_review_company_application` exige `role='company'` y ninguna ficha previa
   (`20260924130000_empresas_f3_onboarding_server.sql:247-252`, aud.).
3. **`provider_kind` es el discriminador del motor.** `provider_workers_all` (quién trabaja):
   autónomo = él mismo si `provider_kind <> 'company'`
   (`20260926120000_empresas_f8_booking_items.sql:112-116`); empresa = miembros activos con
   `counts_as_labour`, con todos los servicios en `company_member_services` y carnet por persona
   (`:118-131`). `provider_max_crew` devuelve 1 salvo `provider_kind='company'`
   (`20260925190000_empresas_f7_crew_multiday.sql:79-91`). La checklist también
   (`20261020120000_provider_setup_status.sql:111`, bloque `team` solo si es empresa `:173`).
4. **Pero hay un segundo discriminador: la fila `companies`.** La leen `provider_allows_split_jobs`
   (`20260925160000_empresas_f6_planning_server.sql:42-50`), el modo de asignación al pagar
   (`20261019120000_own_clients_fee_waiver.sql:739-742`: `assignment_mode='manual'` deja la reserva
   `assignment_pending`), `sync_booking_span` (`20260928120000_duration_holds_and_member_schedules.sql:65-68`),
   los avisos de equipo (`20260929110000_employee_jobs_visibility.sql:107-110`), el cierre de cuenta
   (`20261009100000_self_account_closure_and_storage.sql:151`) y, en TypeScript,
   `booking-authority/index.ts:381-395` y `booking-payment/index.ts:654-659` (aud.). Una empresa
   latente con ajustes de equipo (`max_crew`, `allow_split_jobs`, `assignment_mode`) **divergiría** del
   modo individual. De ahí la decisión D34 (valores de fábrica al volver a individual).
5. **Invariantes de F2** (todas verificadas, ninguna migración posterior las desactiva):
   - un empleado no tiene ficha: `trg_check_company_member_integrity` y
     `trg_check_provider_is_not_employee` (`20260924120000_empresas_f2_provider_model.sql:281-332`);
   - nadie activo en dos empresas: `uq_company_members_one_active_company` (`:104-105`);
   - un solo dueño activo por empresa (`:108-109`);
   - dueño = cuenta de la empresa: `companies.provider_user_id UNIQUE REFERENCES gardener_profiles` (`:72`)
     y `check_company_member_integrity` rama `owner` (`:292-298`).
   - `trg_check_company_provider_kind` (`:258-278`) **exige ficha `company` para crear una empresa**:
     impide una empresa latente en un autónomo. Hay que relajarlo (D32).
   - Hueco real: solo comprueba al crear la empresa; nadie vigila un cambio posterior de `provider_kind`.
6. **Nadie puede escribir `provider_kind` por API** (`:46-47`; `verify-f2-db.mjs` F2-17). El único
   `INSERT ... 'company'` es la aprobación de empresa (aud.).
7. **Dos funciones de rol ya preparadas:** `private.set_account_role_trusted` (`...f3_onboarding_server.sql:94-105`)
   y `signup_role_from_metadata`, que hoy acepta `gardener` y `company` (`:24-34`).
8. **El panel de empresa ya es casi el del autónomo:** `ProfileSettings`, `AvailabilityManager`,
   `BookingRequestsManager` y `GardenerBookings` se comparten (aud.). Solo hay 3 ramas reales por tipo
   en pantallas compartidas (`ProfileSettings.tsx:794`, `SetupGuideBanner.tsx:47`, `providerSetup.ts:472/524`).
9. **`team.employees` y `team.owner_works` ya los devuelve la RPC y ninguna pantalla los lee** (aud.;
   `20261020120000_provider_setup_status.sql:176-184` lo confirma en el servidor).
10. **El registro es el tramo más frágil:** el servidor solo entiende `gardener|company` y un valor desconocido
    cae en `client` sin error (`...f3_onboarding_server.sql:30-33`). `AuthContext.signUp` y `ProfessionalRole`
    deben seguir mandando solo esos dos valores (aud.).
11. **Ficheros de producción con una comparación explícita de rol/`provider_kind`: 25** (`grep` propio; el
    explorador contó 26). Es la superficie real del cambio de interfaz.
12. **Sin ninguna prueba hoy:** `App.tsx`, `Navbar`, `AuthCallbackPage`, `src/pages/empresa/*`, `planner/*`,
    `GardenerDashboard`, `ProfileSettings` (aud.). Las supliré con la batería nueva y el navegador (§6).

### 2.2 Tabla «qué hay hoy → qué debe pasar»

| Capa | Hoy | Debe pasar | Ficheros / objetos |
|---|---|---|---|
| Registro | 3 filas: Cliente / Jardinero / Empresa; `?role=company`, CTA de la landing | 2 filas: Cliente / **Profesional**. `company` queda como alias que equivale a `gardener` | `AccountTypePicker.tsx:8-32`, `AuthForm.tsx`, `oauthAccount.ts:67,106-108`, `GardenersLandingPage.tsx:302` |
| Servidor del registro | `signup_role_from_metadata` → `company`; `self_declare_signup_role` acepta `company` | Ambos devuelven `gardener` aunque pidan `company` | `...f3_onboarding_server.sql:24-34`, `20261104160000...:39-41` |
| `profiles.role` | 5 valores; `company` se asigna al aprobar una empresa | Profesionales siempre `gardener`; `company` sin uso (el CHECK lo admite, no se toca) | `profiles_role_check` |
| Modo | No existe: manda el rol | `provider_kind` = modo, mantenido por un disparador sobre `company_members` | `gardener_profiles.provider_kind` |
| Alta de empresa | Encuesta de 5 pasos + cola de admin + 2 correos | Sin acceso para nadie (código latente, anotado para limpiar) | `CompanyApplicationPage`, `CompanyStatusPage`, `CompanyApplicationsAdmin` |
| Crear empresa | Solo por aprobación de solicitud | `create_company_invitation` promociona si el titular tiene ficha y no tiene empresa | RPC nueva interna `private.ensure_provider_team` |
| Redirección | `company → /empresa`, `gardener → /dashboard` (`postLoginPath.ts:19-24`; `App.tsx:346`) | Profesional → `/dashboard`; allí `modo equipo → /empresa`; `/empresa` sin equipo → `/dashboard` | `App.tsx:337-410,505-526`, `useCompanyOnboarding.ts:57` |
| Menús | Navbar/BottomNav distinguen `company`; `/valoraciones` de cliente a la empresa | Por modo; «Panel» marcado también en `/empresa`; Reseñas propias en equipo | `Navbar.tsx:46-90`, `BottomNav.tsx:14-27` |
| Reseñas propias | Solo en el panel del autónomo (`GardenerDashboard.tsx:354`) | También en modo equipo (misma `gardener_id`) | `CompanyHomePage` |
| Modo individual | Panel de Jardinero de siempre | **Idéntico** + tarjeta discreta «¿Trabajas con más gente?» | `GardenerDashboard.tsx` |
| Sesión | `AccountContext` lee el rol una vez | Lee también el modo; `refreshMode()` al volver a la app, tras invitar/anular/dar de baja y con botón | `AccountContext.tsx:29-80` |
| Correos | CTA `/empresa` y «titular de empresa» si existe fila `companies` | Por `provider_kind` (una empresa latente no es «empresa») | `send-email-notification/index.ts:454,703` |
| Pruebas | F2-01 exige «fila `companies` ⟹ kind `company`» | «`kind='company'` ⟹ hay empresa» y «empresa con ≥1 empleado ⟹ kind `company`» | `verify-f2-db.mjs:105-117` |

## 3. Decisiones nuevas (D31 en adelante)

Autoriza el cambio de diseño **solo para el alcance de esta tarea** (R7). Se copian a `01-PLAN-Y-PROGRESO.md` §2.

| # | Decisión | Sustituye / precisa | Por qué | Estado |
|---|---|---|---|---|
| **D31** | **Una sola cuenta «Profesional».** `profiles.role = gardener` para todo el que ofrece servicios; `company` deja de asignarse y la web lo normaliza a `gardener`. El empleado sigue siendo `employee` y el cliente `client`. | Sustituye **D2** (alta propia de empresa con encuesta y aprobación) y **A-20** (`company` declarable al registrarse). | Una empresa es un autónomo que gestiona un equipo (A-19 ya lo decía: la cuenta de la empresa es la del dueño). Dos cuentas son una complicación sin ganancia. | Resuelta |
| **D32** | **El modo se deriva del servidor.** Equipo ⟺ al menos un empleado activo. `provider_kind` pasa a ser el reflejo de eso, escrito **solo** por un disparador sobre `company_members`; nadie lo cambia por API ni lo guarda el navegador. `trg_check_company_provider_kind` se relaja: una empresa cuelga de una ficha de proveedor, sea del tipo que sea. | Precisa **A-19**; relaja el invariante `F2:258-278`. | Es lo que lee el motor (hallazgo 3). Reescribir esas lecturas obligaría a tocar `booking-authority` y `booking-payment`, que están fuera de alcance. | Resuelta |
| **D33** | **Promoción en sitio.** La empresa (`companies` + dueño `owner`) se crea al **invitar** al primer compañero, dentro de `create_company_invitation`, sobre la ficha existente. La invitación pendiente no cambia la app. El modo equipo empieza al **aceptar**. | Precisa **A-01/A-24** (hoy la empresa solo nace por solicitud aprobada). | Opción A del §4.3. | Resuelta |
| **D34** | **El titular trabaja siempre en modo individual.** Al volver a individual se fuerza `counts_as_labour = true` y los ajustes de empresa vuelven a fábrica (`max_crew=1`, `allow_split_jobs=false`, `assignment_mode='auto'`) y se limpian las propuestas `assignment_pending`. | Precisa **D3** (el dueño elige si trabaja: sigue valiendo en modo equipo) y **D11** («autónomo: siempre 1» = modo individual). | Sin esto, una empresa latente con `assignment_mode='manual'` dejaría reservas esperando una confirmación que la pantalla individual no ofrece (hallazgo 4). | Resuelta |
| **D35** | **¿La promoción a equipo la revisa un admin?** Ver §4.4. | Sustituiría la parte de revisión de **D2/D7**. | **Resuelta por el usuario (2026-11-08): autoservicio con declaración de seguro de responsabilidad civil**, sin revisión previa; la ve el admin en «Profesionales». | Resuelta |
| **D36** | **Un profesional con ficha no puede ser empleado de otro** (A-03 se mantiene). Quien ya es profesional y recibe una invitación ve el mensaje que ya existe («necesitas una cuenta distinta»). Un ex-empleado (miembro inactivo, sin ficha) sí puede hacerse profesional después. | Mantiene **A-03**. | Es una imposibilidad del modelo; la contraria exigiría retirar la ficha del que se une. | Resuelta |
| **D37** | **Cuentas actuales: son de prueba.** La migración solo hace lo imprescindible para aplicar limpia desde cero y sobre producción: las cuentas `company` pasan a `gardener` y se recalcula el modo de todas. Lo que no cuadre (alta de empresa a medias) se recrea a mano. | Sustituye **D8**. | Confirmado por el usuario (2026-11-08): no hay cuentas reales. Los DEFAULT y la compatibilidad se mantienen por buena práctica, no por obligación. | Resuelta |
| **D38** | **El alta de empresa por solicitud queda latente, no se borra.** `/empresa/solicitud`, `/empresa/estado`, la cola «Solicitudes de Empresas» y sus correos no se tocan; ya nadie puede llegar (sin rol `company`). Se anota para limpiar. | Aplica **R3** (no arreglar fuera de alcance). | Borrarlo toca el panel de admin, fuera de alcance. | Resuelta |
| **D39** | **El modo se refresca sin recargar la sesión** (D26 aplicada): al volver a la app, tras invitar, anular o dar de baja, y con un botón «Actualizar». Un aviso de transición (individual ⇄ equipo) se enseña una vez por cambio; lo único que se guarda en el navegador es «último modo visto» (solo para ese aviso, nunca para decidir). | Aplica **D26**. | Mismo criterio que el resto de la web: sin tiempo real. | Resuelta |
| **D40** | **Nada cambia en dinero.** Comisión 12,5 % igual en los dos modos (D1), gastos de gestión y exención de clientes propios sin tocar, un solo motor de precios. El carnet fitosanitario sigue siendo por persona (D4). Los textos legales ya dicen «jardineros autónomos y empresas» (`TermsPage.tsx:25,28`) y no se tocan. | Confirma **D1, D4**. | Fuera de alcance según el encargo. | Resuelta |

## 4. Fase 2 — Diseño

### 4.1 Fuente de verdad del modo

**Recomendación: `provider_kind` mantenido por un disparador, leído por una RPC y servido por un hook.**

- **Dato:** `gardener_profiles.provider_kind` (`'solo'` = individual, `'company'` = equipo). Lo escribe solo
  `private.sync_provider_mode(company_id)`, llamada por un disparador `AFTER INSERT OR UPDATE OF status,role OR DELETE`
  sobre `company_members`, **solo para filas no dueño**. Calcula `employees = count(activos con role <> 'owner')` y fija
  `kind = 'company'` si `employees ≥ 1`, `'solo'` si no. Solo actúa si el valor cambia.
- **Por qué no derivarlo en cada lector:** lo leen 10 migraciones y 2 Edge Functions del motor
  (`provider_workers_all`, `provider_max_crew`, `booking_worker_for_client`, `public_gardener_directory`,
  `provider_setup_status`, `licenseCheckedPerWorker`…). Con el disparador, todos siguen correctos sin tocarlos.
- **Por qué no un interruptor:** el usuario no lo toca (la columna no tiene `UPDATE` para `authenticated`, `F2:46-47`) y
  no hay ningún estado en `localStorage` que decida nada.
- **RPC** `public.my_provider_mode()` (nueva, `SECURITY DEFINER`, solo `authenticated`) devuelve
  `{ is_professional, mode: 'individual'|'team', has_team_structure, active_employees, pending_invitations, owner_works, suspended }`.
  Para quien no es profesional: `{ is_professional: false }`. Ligera: se llama una vez por sesión y al refrescar,
  no cuelga de la checklist (que es pesada).
- **Hook único** `useProviderMode()` sobre `AccountContext` (que ya carga el rol una vez por sesión y descarta
  respuestas de otra sesión, `AccountContext.tsx:29-80`). Expone `{ mode, isProfessional, isTeam, activeEmployees,
  pendingInvitations, ownerWorks, loading, refresh }`. **De él cuelga toda la interfaz**: en el código de producción no debe
  quedar ninguna comparación `role === 'company'` (una prueba que recorre `src/` lo vigila).
- `accountRole.ts`: `normalizeAccountRole('company')` → `'gardener'`. Aunque llegue una cuenta antigua antes de aplicar la
  migración, la web se comporta bien.

### 4.2 Qué es «un segundo jardinero»

**Recomendación: el modo equipo empieza con el primer empleado ACTIVO, no con «dos que trabajan».**

La regla del encargo («dueño que trabaja + empleados con servicios; equipo con 2 o más, o dueño que no trabaja y 1 empleado»)
se reduce a «hay ≥ 1 empleado activo»: si el dueño trabaja, 1 empleado hace 2 personas; si no trabaja, 1 empleado ya es un equipo
que dirige. **Un empleado sin servicios todavía cuenta**: el dueño tiene que poder asignárselos desde la pantalla de equipo
(`set_company_member_services`, `...f3_onboarding_server.sql:485-533`), que solo existe en modo equipo. El motor de venta no
cambia: sigue contando como mano de obra solo a quien tiene `counts_as_labour` y servicios (`provider_workers_all`, `F8:118-131`).

Una invitación pendiente **no** cambia la app; enseña la tarjeta «Invitaciones pendientes (n)» en el panel individual.

### 4.3 Modelo de datos: A frente a B

| Criterio | **A — promoción en sitio** (recomendada) | **B — todo profesional nace con empresa oculta** |
|---|---|---|
| Qué crea | `companies` + miembro `owner` solo al invitar al primer compañero | `companies` + `owner` para **todos** al aprobar la ficha, más relleno de los existentes |
| Ficheros que toca | 1 migración (RPC, disparador, relajar 1 trigger) + hook + pantallas | La anterior + `admin_review_gardener_application` (camino crítico del alta, `20260609200000…:86-120`) + todo lector de «¿hay fila `companies`?» (`F8:363,460,509,549,652`, `F7:1916,1942`, `M28:66`, `MJ:108`, `FW:739`, cierre de cuenta, 2 Edge Functions del motor) |
| Riesgo sobre RLS | Ninguno nuevo: las tablas de empresa siguen solo en lectura (A-17) y la única escritora es una RPC `SECURITY DEFINER` que deriva todo de `auth.uid()` | Cada autónomo pasaría a tener fila en `companies` y `is_company_member`: cambia el significado de `my_company_id()` para todos y de las policies que lo usan |
| Riesgo sobre los invariantes de F2 | Bajo y acotado: relajar `trg_check_company_provider_kind` y mantener `provider_kind` por disparador | Alto: el «dueño solo» pasa a ser el estado normal de la base entera |
| Coste en el autónomo (R2) | Cero hasta que invita; luego, solo la empresa latente con ajustes de fábrica | Constante: todos arrastran una empresa que no usan |
| Reversibilidad | La empresa queda latente (no se borra: `company_members` nunca se borran, `F2:99-101`, y `companies` está `RESTRICT`) | Ya es así de entrada |

**Elección: A.** B convierte un estado excepcional en universal para ahorrar una sola llamada al promocionar, y obliga a tocar
el alta de jardineros y los lectores por fila `companies` (incluido el motor, fuera de alcance). A deja el autónomo sin rastro
hasta que invita. Nunca se acepta un `company_id` del navegador: `create_company_invitation(p_email, …)` y todo lo demás derivan
la empresa de `auth.uid()`.

**Secuencia que la BD impone** (una transacción; ni `authenticated` ni la API pueden hacerla):

1. Validar: ficha existe, no suspendida (`suspended_at`), rol `gardener`, correo válido, tope de 20 invitaciones/24 h.
2. `INSERT companies (provider_user_id = auth.uid())` — necesita el trigger relajado.
3. `INSERT company_members (company_id, user_id, role='owner', counts_as_labour=true)` — exige 2 (`F2:292-298`).
4. Crear la invitación (código existente). Si algo falla, todo se deshace: **no queda empresa a medias**.
5. Al **aceptar** el primer empleado, el disparador pasa `provider_kind` a `company` y, solo en esa transición, deja los
   servicios del dueño = sus servicios activos (si no, la empresa no tendría horas que vender: `F8:121,125-130`).

### 4.4 Alta y aprobación — PREGUNTA (D35)

**Recomendación: sin revisión previa de admin, con una declaración y visible para el admin.**

- El profesional **ya pasó la revisión** del alta de jardinero. Exigir otra para añadir a un compañero rompe «la cuenta se adapta
  sola» y mete una espera justo cuando el profesional quiere crecer.
- Antes de la **primera** invitación, una frase que confirmar: «Mi actividad cuenta con un seguro de responsabilidad civil que cubre
  también a las personas de mi equipo». Se guarda con fecha (`companies.liability_declared_at`). Es el dato que la encuesta de D7
  pedía (seguro de RC) y es lo único de esa encuesta que afecta a la ley.
- El admin ya ve quién es equipo en **«Profesionales»** (etiqueta por `provider_kind`, `ProviderSetupAdmin.tsx:51`, aud.) y puede
  suspender (D30). Sin tipo de aviso nuevo (un tipo nuevo toca SQL, `send-email-notification`, `AdminLayout`: panel de admin,
  fuera de alcance).
- El carnet fitosanitario sigue siendo por persona y lo aprueba el admin (D4): el control más sensible no cambia.

**Alternativa: con revisión previa.** La primera invitación crea una «solicitud de equipo» que revisa el admin antes de poder invitar.
Reutilizar `company_applications` no sirve (exige `role='company'` y ficha nueva): habría que hacer solicitud, RPC de revisión, cola,
contador, 2 correos y pantalla de estado. Más control, más espera y bastante más trabajo (panel de admin, fuera de alcance).

### 4.5 Cuentas existentes (mínimo)

- La migración aplica limpia desde cero (`db reset`) y sobre producción: no borra nada, no exige datos previos.
- Backfill de una sentada: `profiles.role = 'company'` → `'gardener'` (vía `private.set_account_role_trusted`) y recalcular el modo
  de cada empresa con la misma función del disparador.
- **Cuentas `company` de prueba:** las que tienen ficha y equipo siguen funcionando como modo equipo; las que tienen un alta a medias
  (borrador, enviada) quedan como `gardener` sin solicitud y van a «Alta de jardinero»: **se recrean a mano**.
  Las cuentas `gardener` de prueba no cambian.

### 4.6 Casos límite

| Caso | Qué pasa |
|---|---|
| **El empleado se va** | `deactivate_company_member` (`...f3_onboarding_server.sql:559-590`) ya exige que no tenga horas futuras. Al irse el último, el disparador devuelve al modo individual (D34). Cierre de cuenta del empleado (borra o desactiva su fila): el disparador también escucha `DELETE`. |
| **Dueño que no trabaja** | En modo equipo es lo de D3 (interruptor «Yo también trabajo»). Al volver a individual se fuerza a trabajar, porque en individual el titular es el que hace los trabajos. |
| **Autónomo invitado como empleado de otro** | Choca con A-03 y se mantiene: `private.accept_company_invitation_for` rechaza con ficha (`20260927120000_empresas_invitation_signup.sql:52`). Mensaje ya existente. D36. |
| **Empresa suspendida (D30)** | Independiente del modo: `admin_set_provider_suspended` toca `suspended_at` y `companies.status`. La RPC de invitar rechaza a un profesional suspendido. A los empleados no se les avisa (A-55). |
| **Carnet fitosanitario por persona (D4)** | `gardener_licenses` cuelga de `user_id`: no se mueve. En modo equipo el motor mira el carnet **de cada persona** (`F8:131`); en individual, el de la ficha (`bookingEligibilityCore.ts:503-518`, aud.). Una cuenta con las banderas de la ficha pero sin fila en `gardener_licenses` (solo ocurre en la semilla local) **perdería los fitosanitarios químicos** al pasar a equipo: la batería lo cubre con un carnet real. |
| **Reservas futuras al cambiar de modo** | No se tocan: `bookings.gardener_id` y `booking_blocks.assignee_id` siguen siendo el titular (A-19). Asignadas a un empleado, ya impide darle de baja. Las `assignment_pending` se limpian al volver a individual (D34). La batería compara filas antes y después. |
| **Nombre comercial en correos (D28)** | El «nombre de la ficha» es `gardener_profiles.full_name` (no existe `companies.trade_name`). No cambia con el modo; el titular puede ponerle el nombre de su equipo en «Mi perfil». Aviso (aud.): `ProfileSettings.tsx:700-707` escribe el mismo nombre en `gardener_profiles` y en `profiles`. Se anota en `02` (H-46). |
| **Reseñas** | Por `reviews.gardener_id` = titular: ida y vuelta no pierde ninguna. Matiz: no hay forma de separar «lo del equipo» de «lo personal» (H-47). |
| **Enlace y QR** | `provider_booking_links.provider_id` = `user_id` (aud.): sin cambio. Lo ya impreso sigue valiendo. |
| **Dos dispositivos** | Si el empleado acepta mientras el titular tiene la app abierta, el modo cambia al refrescar (D39). Un titular con el modo viejo en memoria que llame a una RPC de equipo recibe el error normal del servidor, nunca datos de otro. |

### 4.7 Experiencia (móvil primero, instalada como app)

- **Modo individual:** la app de siempre, sin una palabra de empresa. Solo se añade, **debajo de los accesos del panel**, una tarjeta
  discreta «¿Trabajas con más gente? **Añade a tu equipo**» que abre una hoja (bottom sheet):
  qué cambia («tendrás agenda por persona, reparto de trabajos y el horario de cada uno»), qué sigue igual («tus servicios, precios,
  enlace de reserva, reseñas y reservas»), la frase de seguro (D35), el campo de correo y «Enviar invitación». Tras enviarla: enlace
  para copiar, «Mientras no acepte, tu cuenta no cambia» y, si hay, la lista de invitaciones pendientes con «Anular» (el mismo
  componente que el panel de equipo).
- **Transición individual → equipo:** al detectar el cambio, una hoja única «Ya tienes equipo» (qué cambia / qué sigue igual /
  «Ver mi equipo») y `/dashboard` pasa a `/empresa`. **Equipo → individual:** «Vuelves al modo individual: tu panel es el de
  siempre». Nunca se recarga la sesión.
- **Modo equipo:** el panel de empresa de hoy, más **Reseñas propias** (hoy no existen, hallazgo 4 de la auditoría) y la
  barra inferior con «Panel» marcado también en `/empresa`. El título del panel sale de la ficha, no de `commercial_name`.
- **Registro:** «Profesional» («Ofrezco mis servicios, solo o con mi equipo») y «Cliente». Misma pantalla por pasos del PR #75;
  la promesa «Después no podrás cambiar el tipo de cuenta» pasa a ser cierta solo para cliente ⇄ profesional.
- Se aplican `garser-ux-movil` (alta y primeros pasos: encabezados fijos, 44 px, sin zoom de iOS) y `docs/design-system.md`;
  `signup` y `onboarding` para el orden de las preguntas.

## 5. Contrato técnico de la migración (`20261108120000_cuenta_profesional_dinamica.sql`)

1. `CREATE OR REPLACE FUNCTION check_company_provider_kind()` → exige solo que exista la ficha (D32).
2. `private.ensure_provider_team(p_user uuid, p_liability boolean)` — idempotente, `SECURITY DEFINER`, `search_path = public`;
   sin `EXECUTE` para nadie salvo definer. Crea `companies` y el dueño con `counts_as_labour = true`.
3. `create_company_invitation(p_email text, p_liability_declared boolean DEFAULT false)` → valida (correo, ficha, no suspendida,
   tope 20/24 h), promociona si no hay empresa y exige la declaración **solo en la primera vez**; el resto, igual que hoy
   (`20260924160000…:14-63`). La firma con `DEFAULT` mantiene compatible el front desplegado.
4. `private.sync_provider_mode(p_company uuid)` + disparador sobre `company_members`:
   - entra en equipo: `provider_kind='company'`; servicios del dueño = servicios activos (`gardener_service_prices.active`);
   - vuelve a individual: `provider_kind='solo'`, dueño `counts_as_labour=true`, `max_crew=1`, `allow_split_jobs=false`,
     `assignment_mode='auto'`, `bookings.assignment_pending=false` del titular.
   Solo con transición real; **no** se dispara por la fila del dueño (así las empresas creadas por el camino antiguo, sin
   empleados, siguen intactas).
5. `public.my_provider_mode()` (§4.1).
6. `signup_role_from_metadata('company')` → `'gardener'`; `self_declare_signup_role('company')` ≡ `'gardener'`.
7. Backfill: `role 'company' → 'gardener'` y recálculo de modo.
8. `companies.liability_declared_at timestamptz` (nullable).

No se toca: `booking-authority`, `booking-payment`, `bookingQuoteCore.ts`, `bookingEligibilityCore.ts`, el motor de precios,
Stripe, el flujo de reserva del cliente, el panel de admin ni los 7 guardas de 12 h.

## 6. Plan en fases cerradas (R4 en cada una)

Cada fase cierra con: `npm test` ≥ línea base (2824) más lo nuevo · `npm run build` · `tsc` sin subir de 128 (informativo) · pruebas de la
fase en `03-PRUEBAS.md` y ejecutadas · `01` y `02` al día · commit. No se empieza una con la anterior a medias. Sin `git push`, sin migrar ni
desplegar producción sin OK explícito.

| Fase | Contenido | Pruebas | «Hecho» cuando |
|---|---|---|---|
| **F-A · BD** | Migración §5. Adaptar `verify-f2-db.mjs` F2-01 a la regla nueva (la empresa latente es válida) y `_company-harness.mjs` solo si hace falta. | `supabase/tests/professional_mode.test.sql` (ida y vuelta, invariantes F2 intactos, `provider_kind` no escribible, promoción atómica, rol `company`→`gardener`, modo por RPC, declaración de seguro). **`verify-professional-mode.mjs`** nueva (individual → equipo → individual con reservas, reseñas, QR, `valid_hours` antes/después y carnet real). `supabase db reset` desde cero. Las 28 baterías de Empresas y las 7 de servicios sin regresión. | Todas verdes; ninguna comprobación existente desaparece; la única que cambia es F2-01, explicada. |
| **F-B · Hook y rutas** | `accountRole` normaliza `company`; `AccountContext` + `useProviderMode()`; `postLoginPath`; `App.tsx` (`/dashboard`, `/empresa`, `/bookings`); `useCompanyOnboarding`; sustituir las 25 comparaciones. | Vitest: hook (carga, refresco, sesión que cambia, error, no profesional), navegación por modo (`/dashboard` ⇄ `/empresa`), prueba que prohíbe `role === 'company'` en `src/`. | Un autónomo cae en su panel, un equipo en el suyo, un cliente y un empleado sin cambios. |
| **F-C · Individual** | Tarjeta y hoja «Añade a tu equipo» (con la frase de seguro), invitaciones pendientes, barrido de vocabulario («empresa» fuera del panel individual, cierre de cuenta incluido). | Vitest de la tarjeta y la hoja; recorrido de pantallas y menús a 375×812 con capturas. | La lista de pantallas y menús del autónomo es idéntica a la de hoy salvo la tarjeta. |
| **F-D · Equipo y transición** | Aviso de transición en los dos sentidos, Reseñas en el panel de equipo, título desde la ficha, `BottomNav` marcado en `/empresa`. | Vitest de la transición y del aviso; recorrido real individual → equipo → individual. | La transición se ve, no recarga y no pierde nada. |
| **F-E · Registro** | Selector de 2 tipos, alias `company`, textos de `AuthForm`, `GoogleAccountPanels`, landing (`GardenersLandingPage`, `publicSiteContent`), `oauthAccount` tolera `company`≡`gardener`. | Actualizar `AuthForm.test.tsx` (36), `oauthAccount.test.ts`, `GardenersLandingPage.test.tsx`; nuevo test de `AuthContext.signUp`/metadato; recorrido con Google simulado. | Un registro nuevo como «Profesional» llega a «Alta de jardinero». Cada enlace antiguo con `?role=company` funciona. |
| **F-F · Correos** | `send-email-notification`: CTA `/empresa` y «titular de empresa» por `provider_kind`, no por fila `companies`. | `verify-f3-emails.mjs` (11) y `verify-provider-suspension.mjs` (6) verdes. | Una empresa latente no recibe correos «de empresa». **Apunta redespliegue.** |
| **F-G · Cierre** | Todo junto, navegador real a 375×812 en los dos modos y la transición, con capturas; `01`, `02`, `03`, `08` al día. | `npm test`, `npm run build`, baterías Empresas (28 / ≥300) y servicios (7 / 269), `db reset`. | §7 del encargo cumplido. |

## 7. Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Empresa latente con ajustes de equipo que diverge del modo individual (hallazgo 4) | Alta | D34: valores de fábrica al volver; prueba en la batería (reserva en modo individual con empresa latente) |
| Un valor de rol desconocido cae en `client` sin error (`F3:30-33`) | Alta | `signUp`, `ProfessionalRole`, `authCallback` y `takeSignupIntent` siguen mandando solo `gardener\|company`; test de `AuthContext.signUp` (no existe hoy) |
| Baterías que crean «empresas sin empleados» por el camino antiguo (`_company-harness.mjs:88-106`) | Media | El disparador no actúa con la fila del dueño; el camino antiguo sigue funcionando; solo cambia F2-01 |
| Caché de modo obsoleta en otra pestaña o dispositivo | Media | `refreshMode()` al volver, tras acciones y con botón (D39); el servidor es la autoridad |
| Fitosanitarios químicos con banderas sin fila de licencia | Media | Solo la semilla local; la batería usa licencia real; se anota en `03` |
| Sin pruebas hoy en `App.tsx`, `Navbar`, `pages/empresa/*` | Media | Pruebas nuevas por fase y recorrido real con capturas |
| Redespliegue obligado de `send-email-notification` | Baja | Solo si se acepta F-F; apuntado en acciones manuales, nada del motor |
| Una persona con modo viejo en memoria invita estando ya en equipo | Baja | La RPC es idempotente y deriva todo de `auth.uid()` |

## 8. Qué se verificó y qué no

**Verificado** (código leído, citado arriba): invariantes de F2, `provider_workers_all`, `provider_max_crew`, `provider_allows_split_jobs`,
`create_company_invitation`, `accept_company_invitation_for`, `deactivate_company_member`, funciones de rol, cierre de cuenta, `provider_setup_status`,
F2-01, `AccountContext`, `postLoginPath`, `useCompanyOnboarding`, rutas de `App.tsx`, línea base de tests.
**No verificado:** nada se ha ejecutado salvo `npm test` y las consultas de estado; el comportamiento de las 28 baterías ante el disparador es
una hipótesis que F-A debe demostrar; las líneas marcadas «(aud.)» vienen de los exploradores.

## 9. Acciones manuales del usuario

**Nada se ha empujado ni desplegado** (sin `git push`, sin migración ni función en producción). Para llevarlo a producción, **en este orden** y juntos (el
front antiguo con la migración nueva sigue funcionando, pero sin el modo equipo hasta que se publique el nuevo):

1. **Antes de migrar**, en producción: `select status, count(*) from company_applications group by 1;`. Si hay alguna `submitted`, recházala desde el admin
   (con la migración ya no se podrá aprobar: la cuenta deja de tener rol `company`).
2. `supabase db push --linked` → aplica `20261108120000_cuenta_profesional_dinamica.sql`. Comprobar: ninguna cuenta con `profiles.role = 'company'` y
   `select count(*) from gardener_profiles gp left join companies c on c.provider_user_id = gp.user_id where (c.id is null and gp.provider_kind <> 'solo') or (c.id is not null and gp.provider_kind <> 'company' and exists (select 1 from company_members m where m.company_id = c.id and m.status='active' and m.role <> 'owner'))` = 0.
3. `supabase functions deploy send-email-notification --use-api` (los correos de carnet/suspensión distinguen el modo).
4. Abrir la PR y fusionarla (Vercel publica el front). **Aún no hay PR abierta.**
5. Pasar la **sección 34** de `docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md` (34.4 y 34.6 son bloqueantes).
6. Las cuentas de prueba que eran «Empresa» con un alta a medias (borrador o enviada) se recrean a mano como profesional.
7. **Solo en local:** tras un `supabase db reset` hay que volver a crear los secretos del Vault (`lifecycle_tick_url` y `lifecycle_tick_secret`), si no los avisos no salen (H-53).

## 10. Lo que cambió al ejecutar (se va completando)

**F-A · base de datos (hecha).** `supabase/migrations/20261108120000_cuenta_profesional_dinamica.sql`, tal como describe §5. Diferencias con lo diseñado:

- `create_company_invitation(p_email, p_liability_declared DEFAULT false)`: **se borra la firma antigua** `(text)` antes de crear la nueva (dos sobrecargas
  hacen ambigua la llamada por nombre desde PostgREST). El front ya desplegado, que solo manda `p_email`, sigue funcionando.
- La declaración de seguro se exige **solo al promocionar** (cuando aún no hay empresa). Las empresas antiguas (alta por solicitud) no la piden: su
  encuesta ya preguntaba por el seguro.
- `my_provider_mode()` devuelve además `liability_declared`.
- Al entrar en equipo, los servicios del titular son los **activos y, si son fitosanitarios, solo con carnet válido** (las mismas reglas que
  `set_company_member_services`). Al volver a entrar tras una baja, se rehacen con los activos de ese momento; un compañero que vuelve conserva los suyos.
- El backfill pasó las cuentas locales de empresa a `gardener` y las empresas sin empleados a individual (D37).
- Pruebas: `supabase/tests/professional_mode.test.sql` (verifica además con dos mutaciones: sin el disparador falla 5b; sin el reinicio de servicios, 5d) y
  `scripts/garser-empresas/verify-professional-mode.mjs` (**21/21**: registro, promoción, aceptación, horas que suman, ida y vuelta sin pérdidas,
  reparto manual → individual sin reservas colgando, reutilización de la empresa latente y carnet del titular). **29 baterías (332 comprobaciones) en
  verde tras `supabase db reset` desde cero**; las 8 SQL de `supabase/tests/` también.
- Cambios de expectativas en pruebas antiguas (R2), todos explicados en `02` H-51…H-55: F2-01 (nueva regla de D32), F3-21 (registrarse «company» da
  `gardener`), F3-31 (inserción del carnet por SQL), y `provider_setup_status.test.sql` (al irse el último empleado la cuenta vuelve a individual:
  se comprueba y se reincorpora a Ana para seguir probando el modo equipo).

**F-B · hook y rutas (hecha).** `AccountContext` lee el modo junto al rol para los `gardener` (`providerMode`, `providerModeError`,
`refreshProviderMode`, relectura al volver a la app si lo último tiene más de 20 s) y `useProviderMode()` lo expone. `/dashboard` decide con la función pura
`professionalHome` (`src/utils/professionalHome.ts`): aprobada + equipo → `/empresa`; aprobada + individual → el panel de siempre. `useCompanyOnboarding` pasó a
ser la puerta de `/empresa/*` (equipo = «aprobada»). Las 25 comparaciones de rol se sustituyeron y una prueba recorre `src/` para que no vuelvan
(`src/lib/noCompanyRole.test.ts`). `Navbar`/`BottomNav`: «Panel» queda marcado también en `/empresa` (`navActive.ts`).

**F-E · registro (hecha).** El selector tiene dos tipos (Cliente, **Profesional**: «Ofrezco mis servicios de jardinería, solo o con mi equipo»). Un
`?role=company`, un estado de navegación o una sesión vieja se leen como profesional (`parseAccountType`, `authCallback`, `takeSignupIntent`); `AuthContext.signUp` y
el servidor lo normalizan también. La sección «Empresas» de `/para-jardineros` crea la misma cuenta («Crear mi cuenta para mi equipo»).

**F-C · modo individual (hecha).** La tarjeta «¿Trabajas con más gente? **Añadir a mi equipo**» (`TeamEntryCard`) va debajo de los accesos del panel y de la
guía de primeros pasos, solo en modo individual con la cuenta en regla. Abre `AddTeamSheet` (hoja con `BottomSheet`): *Qué cambia*, *Qué sigue igual*, la
frase del seguro (solo si aún no hay empresa: `hasTeamStructure`) y `InviteMemberCard` en variante `bare`. Tras enviar: enlace para copiar y «Mientras no
acepte, tu cuenta no cambia». Con invitaciones pendientes la tarjeta las lista (lectura directa de `company_invitations`, que ya podía leer el dueño) con
«Anular» y «¿Ya ha aceptado? Actualizar». **Barrido de vocabulario:** además de lo que ya salía limpio, había un solo sitio que enseñaba «empresa» a un
individual con empresa latente: el texto de «Cerrar cuenta» (`selfAccountClosure.ts`); ahora solo habla de empresa con empleados activos. La pregunta de
las preguntas frecuentes de `/para-jardineros` (`billingCopy.ts`) también decía «das de alta tu empresa».

**F-D · equipo y transición (hecha).** `ProviderModeNotice` (montado en `App.tsx`) enseña **una vez por cambio** «Ya tienes equipo» o «Vuelves al modo
individual»; lo único que guarda el navegador es el último modo visto (`garser.providerMode.lastSeen:<usuario>`), y solo sirve para ese aviso. Panel de
equipo: **Reseñas propias** (`/empresa/resenas`, enlace en «Tu empresa»; antes una empresa no tenía ninguna entrada a ellas). La etiqueta de Mi cuenta y de
la barra es «Jardinero» en individual y «Empresa» en equipo. **Hallazgo al verificar en el navegador:** dar de baja al último compañero no refrescaba el
modo (la pantalla de equipo seguía hasta recargar); `CompanyHomePage` ahora relee el modo tras la baja y salta sola al panel de siempre.

**F-F · correos (hecha).** `send-email-notification`: el enlace «Ir a mi panel» y «titular de empresa» salen de `gardener_profiles.provider_kind`, no de la
fila `companies` (una empresa latente no cuenta). **Obliga a redesplegar la función** (§9). `PM-22` lo cubre y falla con el código anterior.

## 11. Cierre (qué se verificó y qué no)

**Verificado (2026-11-08, local):**

- `npm test`: **2918 en verde / 197 ficheros** (línea base 2824 / 185). `npm run build` ✅. `tsc` igual que la línea base (126; el repo parte de 126, no 128).
- `supabase db reset` desde cero ✅ (repetido al final con la semilla corregida) + los 8 ficheros SQL de `supabase/tests/` ✅ (A6 de `admin_review_notifications` exige la tabla de avisos vacía: H-54; con la base recién creada pasa).
- **29 baterías de Empresas ✅ (incluida la nueva, 22/22)** y las **7 de servicios por HTTP: 269/269, 0 fallos** (cesped 33, setos 35, arbustos 18, árboles 15, palmeras 71,
  desbroce 19, fitosanitarios 78). Al medirlas tras el `db reset` aparecieron 2 fallos de fitosanitarios que eran de la semilla, no de este cambio (H-58, corregida).
- Navegador 375×812 con `scripts/garser-empresas/demo-professional-mode.mjs`: registro con dos tipos; individual → invitación (con seguro) → pendiente →
  aceptación → «Actualizar» → `/empresa` + aviso; panel de equipo, Reseñas con la misma reseña; baja → vuelta sola al panel de siempre + aviso; vuelta a
  invitar sin volver a pedir el seguro; refresco al volver a la app (`visibilitychange` tras 20 s). Capturas en `capturas-08/`.
- **Pantallas y menús del modo individual sin ninguna palabra de empresa/equipo/empleado/compañero/titular** (salvo la tarjeta de equipo): Panel, Solicitudes,
  Disponibilidad, Mi perfil, Reseñas, Marketing, Reservas, Chat, Mi cuenta (con «Cerrar cuenta»), barra superior e inferior.

**No verificado / límites honestos:**

- **No se ha probado en producción ni con el iPhone real** (la batería está en `PRUEBAS-PRODUCCION.md` §34; 34.8 es con el iPhone).
- Los correos se comprueban con el envío simulado local (`MOCK EMAIL SEND`); el enlace del correo del carnet sí se ve en el registro, el de suspensión no.
- No se probó la **concurrencia** (dos pestañas del titular, o aceptar y dar de baja a la vez): el servidor es la autoridad y la RPC es idempotente, pero no hay prueba.
- Un empleado que cierra su cuenta (borrado de su fila) devuelve el modo individual por el disparador (cubierto en SQL) pero no hay prueba de extremo a extremo de
  `account-closure` con un equipo.
- `CompanyApplicationPage`, `CompanyStatusPage`, su cola de admin y sus correos quedan **latentes e inaccesibles** (D38); limpieza pendiente (H-49).
- Una cuenta de empresa **antigua en producción con una solicitud enviada sin aprobar** no se podrá aprobar (ya no tiene rol `company`): se rechaza desde el admin
  o se recrea (§9).
