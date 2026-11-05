# Seguimiento — UX móvil del alta y primeros pasos del profesional (2026-11-05)

Plan: [PLAN-IMPLEMENTACION.md](PLAN-IMPLEMENTACION.md). Aprobado completo por el usuario el 2026-11-05, con estas respuestas:

1. «Check» del 7.1 = los circulitos de cada servicio (Mi perfil → Servicios) que activan y desactivan; también dentro de la ayuda.
2. Primeros pasos: lo más fácil e intuitivo → la ayuda va **encima** de los atajos mientras falte algo obligatorio.
3. Antelación mínima y semanas a mantener: **también sin preconfigurar**, y un **aviso** a los profesionales de que les quedan cosas por configurar para completar el horario.
4. Fase 2: **ambas** — botón «Actualizar estado» y relectura al volver a la app.

Método: cada fase se implementa, se prueba con tests, se prueba **navegando de verdad** en local con cuentas de prueba (375 px) y solo entonces se marca hecha. Sin commit de código ni despliegue hasta que el usuario lo pida.

| Fase | Fallos | Estado |
|---|---|---|
| 1 — Encabezados apilados | 3, 5a, 1, 2 | ✅ Hecha y verificada en local (2026-11-05) |
| 2 — Actualizar estado de la solicitud | 6 | ✅ Hecha y verificada en local (2026-11-05) |
| 3 — Confirmar esta dirección | 4 | ✅ Hecha y verificada en local (2026-11-05) |
| 4 — Horario y reglas sin preconfigurar + aviso | 5b | ✅ Hecha y verificada en local (2026-11-05) |
| 5 — Botón Activar de tres estados | 7.1 | ✅ Hecha y verificada en local (2026-11-05) |
| 6 — Primeros pasos guiados | 7.2 | ⏳ |

## Fase 1 — hecha

**Qué se cambió**

- `src/hooks/useStickyHeight.ts` (nuevo): cada barra fija publica su alto real en una variable CSS del `<html>`.
- `Navbar` publica `--app-navbar-h`; `AppHeader` pasa de `sticky top-0 z-40` a `sticky z-30` con `top: var(--app-navbar-h, 0px)`.
- `StickyStepProgress` (nuevo): progreso **fijo** bajo el `Navbar` en `CompanyApplicationPage` y `GardenerApplicationWizard`.
- `src/index.css`: `scroll-padding-top` global con las variables.
- `App.tsx`: las páginas de alta/estado ya no llevan `pb-16` (hueco de un menú inferior que ahí no existe).
- `CompanyStatusPage`: alto = pantalla menos la barra, no `min-h-screen`.
- `docs/design-system.md` §5: reglas de barras apiladas.

**Causas reales** (las dos primeras confirmadas con medidas; la tercera, por reproducción)

- Fallos 3 y 5a: `Navbar` y `AppHeader` eran los dos `sticky top-0 z-40`.
- Fallo 2: el `<main>` de `App.tsx` añade `pb-16` también en las páginas de alta/estado, donde no hay menú inferior → la página tenía **64 px de scroll de más**; al bajarlos, la tarjeta «Solicitud en revisión» se metía bajo la barra fija (medido: la tarjeta pasaba de y=97 a y=33 con la barra acabando en y=65). Ahora la página mide exactamente la pantalla y no hay scroll.
- Fallo 1: el progreso iba dentro de la página; ahora va fijo (y=65 en todas las posiciones de scroll, medido).

**Verificación local (375×812, base local)**

| Pantalla | Cuenta | Resultado medido |
|---|---|---|
| Panel de empresa (4 pestañas) | `empresa-aprobada.ux` | Navbar 0-65, AppHeader 65-172 a scroll 0/150/400/900, sin solape |
| Mi cuenta, Disponibilidad de empresa | `empresa-aprobada.ux` | AppHeader pegado a 65 en todo el recorrido |
| Mi trabajo | `empleado.ux` | idem |
| Disponibilidad (jardinero), Mis reservas, Chat | `jardinero.local` | idem |
| Alta de empresa | `empresa-borrador.ux` | progreso fijo a 65 en 4 posiciones de scroll |
| Alta de jardinero | `jardin-solicitud.ux` | idem |
| Estado «en revisión» (empresa) | `empresa-enviada.ux` | alto = pantalla (812/812), sin scroll, tarjeta a y=97 |
| Estado «en revisión» (jardinero) | `jardin-revision.ux` | alto = pantalla, tarjeta a y=111 |

Tests nuevos: `useStickyHeight` (5), `AppHeader` (4), `StickyStepProgress` (3). Suite completa: 176 archivos, 2.739 tests en verde.

**Pendiente del usuario (no verificable en el emulador):** confirmar en el iPhone, con la web instalada, que el progreso del alta y el mensaje «en revisión» ya no quedan tapados.

**Observación:** en «Gestión de disponibilidad» la pila fija (Navbar + cabecera con pestañas y botón Guardar) ocupa 226 px de los 812. No se toca en esta ronda; si molesta, se compacta más adelante.

## Fase 2 — hecha

**Qué se cambió**

- `RefreshApplicationStatus` (nuevo, `components/common`): botón **«Actualizar estado»** (texto visible también en el móvil) + la misma comprobación **en silencio al volver a la app** desde segundo plano (reutiliza `useRefreshOnReturn`, mínimo 10 s entre comprobaciones). Dice «Sigue en revisión», «¡Solicitud aceptada! Entrando en tu panel…», «Tu solicitud no se ha aceptado…» o «No se ha podido comprobar…». Al volver solo habla si cambió algo.
- `RefreshButton`: nueva opción `alwaysShowLabel` (en el móvil solo salía el icono).
- Empresa: `useCompanyOnboarding().recheck()` — relee **sin** poner la pantalla en «cargando» (el botón no se desmonta) y devuelve el estado; un fallo de red se propaga. `CompanyStatusPage` lo usa.
- Jardinero: `App.tsx` saca la lectura del estado a `loadApplicationStatus` (misma lógica de siempre; con `strict`, un fallo de red se propaga en vez de dejar el estado en null) y se la pasa a `GardenerStatusPage` como `onRefresh`. Al pasar a «active», la regla de redirección de siempre lleva al panel.
- Solo en «en revisión»: en una solicitud rechazada no hay botón (ahí lo que toca es corregirla).

**Verificación local (375×812)**

| Caso | Resultado |
|---|---|
| Empresa en revisión, pulsar el botón | Toast «Sigue en revisión…», la pantalla no parpadea ni se vacía |
| Empresa: el admin acepta (RPC `admin_review_company_application`) con la pantalla abierta → pulsar | Pasa de `/empresa/estado` a `/empresa` (panel «Jardines Enviada») **sin cerrar sesión** |
| Jardinero en revisión, pulsar el botón | Toast «Sigue en revisión…», sigue en `/status` |
| Jardinero: el admin acepta (`admin_review_gardener_application`) → vuelve a la app (`visibilitychange`) sin pulsar nada | Pasa de `/status` a `/dashboard` sola |

Tests nuevos: `RefreshApplicationStatus` (7), `useCompanyOnboarding` (5), `GardenerStatusPage` (+2). Suite completa: 178 archivos, 2.753 tests en verde.

**No verificado en vivo:** el fallo de red (cubierto con tests: no cambia nada, avisa y se puede reintentar) y el rechazo detectado tras actualizar.

## Fase 3 — hecha

**Qué se cambió**

- `CoverageTab`: con dirección escrita y **sin coordenadas**, un bloque «Falta confirmar tu zona de trabajo» con la dirección y los km que se van a guardar y el botón **«Confirmar esta dirección»**. Sin doble toque; si la dirección no se puede localizar, aviso en rojo y el botón sigue. Con coordenadas: «Zona confirmada. Los clientes de tu zona ya pueden verte.» (antes, jerga: «coordenadas operativas para el filtrado de reservas»).
- `ProfileSettings.onSaveProfileInfo`: ahora devuelve `true/false` y admite un mensaje propio («Zona de trabajo confirmada»). Es el **mismo guardado de siempre** (`getCoordinatesFromAddress` + `persistGardenerProfile`); no se tocó su lógica. `handleSubmit` lo llama envuelto para no pasarle el evento como segundo argumento.
- `providerSetup.ts` (paso «Zona de trabajo» de la ayuda): con la dirección ya escrita dice «Tu dirección ya está escrita (…), pero falta confirmarla» y el botón «**Confirmar mi zona**» (antes «Configurar zona», como si hubiera que empezar de cero).

**Causa:** una cuenta recién aprobada trae la dirección de su solicitud sin coordenadas, y el guardado automático solo actúa cuando algo cambia (`useAutoSave`); sin tocar la dirección o el radio, no contaba.

**Verificación local (375×812, `jardin-nuevo.ux`)**

| Caso | Resultado |
|---|---|
| Pestaña Cobertura con dirección sin coordenadas | Bloque ámbar con dirección + «Hasta 25 km» + botón |
| Pulsar «Confirmar esta dirección» (geocodificación real de Google) | En la BD: `36.511206, -4.885432`; aviso verde «Zona confirmada»; el botón desaparece |
| Dirección imposible («zzzqqq xxxkkk 99999 nowhere») | Aviso rojo «No hemos podido localizar esa dirección…» + toast; sin coordenadas guardadas; el botón sigue activo |
| Ayuda del panel | «Tu dirección ya está escrita (Calle Ancha 5…), pero falta confirmarla» + «Confirmar mi zona» |

Tests nuevos: `CoverageTab` (6), `providerSetup` (+2). Suite completa: 179 archivos, 2.761 tests en verde.

**Hallazgo para la Fase 6:** `GardenerDashboard` guarda la última pestaña en `localStorage.gardener_active_tab` y la reabre. Un jardinero que dejó «Disponibilidad» abierta vuelve a entrar **dentro** de ella, no en el panel con la guía. Se trata en la Fase 6.

## Fase 4 — hecha

**Qué se cambió** (`RecurringScheduleManager`, `providerSetup.ts`, `useProviderSetupStatus`)

- **Nada preconfigurado:** la franja («Desde»/«Hasta»), las semanas de agenda y la antelación mínima arrancan **vacías** (`Elige hora`, `Elige una opción`). Antes: 9-17, «1 mes» y «24 horas» puestos y guardados sin que nadie los eligiera.
- Marcar días **no pinta nada** si no hay franja (las dos horas); con días y franja, se rellena como siempre. Los horarios ya guardados se cargan igual.
- **Guardar exige elegir las reglas:** sin semanas (y, en el horario propio, sin antelación) no se guarda: aviso «Antes de guardar, elige…», campos en rojo (`aria-invalid`), y la pantalla baja a ellos. Vale para el botón de guardar, para la confirmación y para «Guardar y salir». Un **empleado** (la antelación la decide su empresa) solo necesita las semanas, y su guardado ya no envía una antelación que no es suya.
- **Aviso «Te quedan cosas por configurar en tu horario»** arriba de «Horario fijo», con la lista de lo que falta (días y horas, semanas, antelación), que se vacía según elige y lleva a las reglas. Para el dueño que prepara el horario de un empleado dice «Quedan cosas… en su horario» / «trabaja».
- **Ayuda del panel:** nuevo paso **recomendado** «Reglas de tu horario» (autónomo): pendiente si no existe su fila de `recurring_availability_settings`; no bloquea «ya apareces». El dato lo lee el navegador (el servidor no se toca).
- Los 4 `<select>` pasan a 16 px en el móvil (`text-base sm:text-sm`): iOS hacía zoom al tocarlos.
- Corregido un fallo de paso: `settData.min_notice_hours || 24` convertía «Sin restricción» (0 h) en «24 horas» al volver a entrar; ahora `??`.

**No se tocó:** `applyRecurringSchedule`, `generate_recurring_slots`, `set_member_recurring_schedule` ni el servidor. Solo cambia qué valores hay al empezar y que no se guarda hasta haberlos elegido.

**Verificación local (375×812)**

| Caso | Resultado |
|---|---|
| `jardin-nuevo.ux` abre «Horario fijo» | Cuatro selects vacíos a **16 px**; aviso con 3 puntos |
| Marcar L y M sin franja | El calendario **no se rellena**; el aviso sigue pidiendo la franja |
| Elegir solo «Desde 09» | Sigue sin rellenar |
| Elegir «Hasta 14» | Se rellenan los 2 días × 5 horas; desaparece «Los días y las horas…» |
| «Guardar cambios» sin reglas | Toast «Antes de guardar, elige las semanas de agenda y la antelación mínima.»; **sin** diálogo de confirmación; 2 campos en rojo; baja a las reglas |
| Elegir 1 mes y 48 h → guardar → confirmar | Desaparece el aviso; BD: `recurring_availability_settings` = 4 semanas / 48 h y `recurring_schedules` = L y M 09:00-14:00 |
| Sin fila de reglas (borrada a mano) | La ayuda enseña «Reglas de tu horario» pendiente («4 pendientes») |
| `jardinero.local` (horario ya guardado) | Carga 08:00-18:00 y «1 mes» como siempre; sin aviso |
| Dueño abre el horario de `empleado.ux` | Sin antelación; aviso solo con días/horas y semanas, en tercera persona |

Tests: `RecurringScheduleManager` 3 → 14, `providerSetup` +2. Suite completa: 179 archivos, 2.774 tests en verde.

**Pendiente de decidir (no bloquea):** la semilla local de `jardinero.local` tiene antelación de 12 h, que no está entre las opciones del selector (0/24/48/72/168): la pantalla muestra «Sin restricción» aunque guarda 12. Es anterior a esta ronda y solo afecta a datos de prueba.

## Fase 5 — hecha

**Qué se cambió**

- `ServiceActivateButton` (nuevo): botón **«Activar»** con tres estados — **gris muy claro** (no se puede activar: falta el precio; sigue siendo tocable, `aria-disabled` y no `disabled`), **gris más oscuro** (configurado, se puede activar) y **verde «Activado»**. Mínimo 44 px, sin doble toque.
- `ServiceItem` (Mi perfil → Servicios): el círculo mudo se sustituye por ese botón. Dos filas (nombre + engranaje / qué falta + botón) para que en 375 px el nombre no quede en una columna estrecha. Pistas: «Primero configura tu precio con el engranaje», «Configurado. Falta activarlo», «Activado: los clientes pueden reservarlo».
- `ServicesTab`: tocar un servicio **sin configurar** ya no da un error suelto: avisa «Primero configura el precio de X» y **abre su configuración**. `ProfileSettings` solo pasa `canActivateService` (usa su `isServiceConfigValid` de siempre); no se tocó `handleToggleService`.
- `serviceActivation.ts` (nuevo): `isSavedServiceConfigValid` (los **mismos validadores** del configurador, con la normalización de fitosanitarios), `loadServiceActivation` y `setServiceActive` (cambia **solo** `active` y deja al día `gardener_profiles.services`).
- **Ayuda «Completa tu cuenta»**, paso «Servicios y precios»: con servicios configurados y sin activar dice **«Tienes N servicios configurados pero sin activar: A y B. Actívalos…»** y enseña **cada servicio con su botón** para activarlo ahí mismo; los empezados a medias salen en gris claro y llevan a terminarlos. Con uno ya activo y otros sin activar, el paso queda hecho y avisa «Tienes además…». Los datos los lee el navegador (`useProviderSetupStatus`); el servidor no se toca.

**No se tocó:** precios, configuradores, el contenido de la configuración guardada, RLS ni funciones.

**Verificación local (375×812, `jardin-nuevo.ux`; sembrados 2 servicios válidos y 1 a medias con `{}`)**

| Caso | Resultado |
|---|---|
| Ayuda del panel | «Tienes 2 servicios configurados pero sin activar: Corte de césped y Poda de setos» + 3 botones: **Activar** oscuro, **Activar** claro (árboles, a medias), **Activar** oscuro |
| Pulsar «Activar» en césped, en la ayuda | Toast «Corte de césped activado»; el botón pasa a verde **Activado**; el paso queda «Hecho» con «Tienes además 1 servicio configurado…»; BD: `active = true` y `gardener_profiles.services` = [césped] |
| Mi perfil → Servicios | Césped **Activado** (verde), setos **Activar** (oscuro), los otros 5 **Activar** (claro) con su pista; layout a dos filas legible |
| Activar setos / desactivar césped desde Mi perfil | Setos → verde; césped → vuelve a oscuro; BD coherente |
| Tocar «Activar» claro (Desbroce) | Toast «Primero configura el precio de Desbroce de malas hierbas.» y se abre su configuración |

Tests nuevos: `ServiceActivateButton` (5), `ServiceItem` (4), `ServicesTab` (5), `serviceActivation` (10), `providerSetup` (+7), `ProviderSetupChecklist.services` (6). Suite completa: 184 archivos, 2.810 tests en verde.

**Límite de lo verificado:** el paso «configurar y guardar un servicio desde cero hasta que el botón pasa a oscuro» se probó con configuraciones ya válidas cargadas de la base (las de la semilla), no rellenando el formulario del configurador a mano. El mismo `isServiceConfigValid` decide en los dos casos.
