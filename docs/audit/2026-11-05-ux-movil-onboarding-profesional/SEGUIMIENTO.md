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
| 3 — Confirmar esta dirección | 4 | ⏳ |
| 4 — Horario y reglas sin preconfigurar + aviso | 5b | ⏳ |
| 5 — Botón Activar de tres estados | 7.1 | ⏳ |
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
