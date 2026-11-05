# Plan de implementación — UX móvil del alta y primeros pasos del profesional (2026-11-05)

Origen: tanda de 9 fallos que el usuario detectó usando garser.es desde el iPhone al crear una
cuenta de jardinero y de empresa. Este documento es el **contrato**: se aprueba por fases, no por
diffs, y cada fase se despliega sola. Skill aplicada: `garser-ux-movil`.

Estado: **PLAN — pendiente de aprobación. No se ha tocado código de la web.**

---

## 1. Triaje (qué es cada fallo y de quién es)

| # | Lo que ves | Causa en el código | Tipo | Riesgo |
|---|---|---|---|---|
| 3 | El menú de la empresa (Agenda · Equipo · Marketing · Tu empresa) se monta encima del encabezado al hacer scroll | `Navbar.tsx:91` y `AppHeader.tsx:31` son **los dos** `sticky top-0 z-40`. Medido en local: `nav` y `header` → `position: sticky; top: 0; z-index: 40`. Se pisan. Lo introdujo la ronda del 2026-09-14 (Fase 1 creó `AppHeader`; Fase 6, fallo 16, hizo `sticky` al `Navbar`) sin coordinar los dos | Diseño | **Medio** (componente compartido por 6 pantallas) |
| 5a | En «Gestión de disponibilidad» el encabezado también se solapa | Misma causa que el 3 (`AvailabilityManager.tsx:436` usa `AppHeader`) | Diseño | — (lo cierra la Fase 1) |
| 1 | La barra de progreso del alta de empresa queda tapada por el encabezado y solo se ve deslizando hacia abajo | **No reproducido** en el emulador (a scroll 0 la barra queda a 105 px y el `Navbar` acaba a 65 px). Hipótesis: al llegar o al pulsar «Siguiente» la página no queda arriba del todo (el progreso va dentro de la página, `CompanyApplicationPage.tsx:174-179`, y el `Navbar` sticky se lo come). Solución robusta que no depende de la causa: progreso **fijo bajo el `Navbar`** | Diseño | Bajo |
| 2 | El encabezado tapa parte del mensaje «Solicitud en revisión» | Igual que el 1: `CompanyStatusPage.tsx:30` (`min-h-screen` + `py-10`) y `GardenerStatusPage.tsx:57` (`min-h-[80vh]`) no reservan el hueco del `Navbar` sticky. Se arregla con el mismo desplazamiento global (`scroll-padding-top`) y quitando el `min-h-screen` que suma 100 vh + el `Navbar` | Diseño | Bajo |
| 4 | La zona de trabajo escrita no queda «válida» si no se toca la dirección o el radio | `CoverageTab.tsx` solo guarda con `useAutoSave` cuando algo **cambia**. Un jardinero recién aprobado trae la dirección de su solicitud pero **sin coordenadas** (`operational_latitude/longitude` vacías), y el paso «Zona de trabajo» del apartado de ayuda sigue en «pendiente» (`providerSetup.ts:175-193`, depende de `has_coordinates`) | **Lógica ligera (pedida por ti)**: un botón que llama al guardado que ya existe (`onSaveProfileInfo` → `getCoordinatesFromAddress`) | Bajo-medio |
| 5b | El horario base viene preconfigurado de 9 a 17 | `RecurringScheduleManager.tsx:87-88`: `useState(9)` y `useState(17)`. Al pulsar un día se pinta 9–17 sin que la persona haya elegido nada | **Lógica ligera (pedida por ti)**: estado inicial vacío | Medio |
| 6 | Si el admin acepta la solicitud, no se ve hasta cerrar sesión y volver a entrar | `App.tsx:155-217` calcula el estado una sola vez por sesión; `GardenerStatusPage` y `CompanyStatusPage` no tienen forma de volver a preguntarlo. Ya existe `RefreshButton` (`components/common/RefreshButton.tsx`) y `useCompanyOnboarding().refresh` | **Lógica ligera (pedida por ti)** | Bajo-medio |
| 7.1 | Configuras los precios pero el servicio no se activa solo: el apartado de ayuda sigue diciendo «Activa al menos un servicio» | El servidor (`provider_setup_status`) solo cuenta servicios con `active = true`; uno configurado y apagado no existe para el apartado. En «Mi perfil → Servicios» (`ServiceItem.tsx`) la activación es un círculo vacío sin texto; si la configuración está incompleta, al tocarlo salta «Configuración incompleta» y abre el configurador | **Lógica ligera (pedida por ti)** + diseño | **Medio-alto** (`ProfileSettings.tsx` tiene 840 líneas) |
| 7.2 | El apartado «Completa tu cuenta profesional» no guía: hay pasos que se adivinan | Ver §3 | Diseño de flujo | Medio |

**Qué no se toca en ninguna fase:** precios, rendimientos, motor de reservas, cálculo de disponibilidad,
Edge Functions, RLS. Todo se apoya en guardados que ya existen.

> Los documentos `docs/ux-patterns.md` y `docs/ux-checklist.md` que cita la skill **no existen** en el
> repo (solo `docs/design-system.md`). Lo que haga falta documentar va a `design-system.md`.

---

## 2. Hallazgos extra (los dejo anotados; solo entran si los apruebas)

- Los `<select>` del generador de horario (`RecurringScheduleManager.tsx:489, 505, 655, 678`) son `text-sm` (14 px): iOS hace zoom al tocarlos. Rompe la regla de 16 px. Entra en la Fase 4 porque se toca ese bloque.
- En el panel del jardinero, **lo primero que se ve son 6 atajos** (`GardenerDashboard.tsx:355-380`) y la ayuda «Completa tu cuenta» queda debajo, casi fuera de pantalla (`:435`). Es la raíz del 7.2.
- La antelación mínima (24 h) y las semanas a mantener (4) también vienen preconfiguradas (`RecurringScheduleManager.tsx:90-93`). **Pregunta abierta 3.**

---

## 3. El 7.2 explicado: dónde el jardinero tiene que adivinar

Recorrido real con una cuenta de jardinero aprobado sin configurar (375 px):

1. **Panel:** 6 botones grandes arriba; la ayuda, debajo.
2. **«Configurar servicios»:** cae en «Mi perfil → Servicios»: siete filas con un círculo vacío y un engranaje. Nada dice que **primero** se pone el precio (engranaje) y **después** se activa (círculo). Tocar el círculo sin precio da un error.
3. **Configurador de un servicio:** formulario largo; al guardar no se dice «ya puedes activarlo».
4. **«Configurar zona»:** la dirección ya está escrita y parece hecha, pero no cuenta hasta tocarla (fallo 4).
5. **«Crear horario»:** aparece con 9–17 puesto (fallo 5b) y una ayuda larga escondida.
6. Al volver al panel no se ve qué se acaba de conseguir ni cuál es el siguiente paso.

Propuesta (se concreta en las Fases 5 y 6):

- **Primeros pasos primero:** mientras falte algo obligatorio, la ayuda va **arriba** del panel y los atajos debajo.
- **Un paso a la vez:** el paso actual grande, con **«Qué tienes que hacer» en 2-3 líneas numeradas** y un solo botón; los demás, plegados con su estado.
- **Cada destino sabe que vienes de la ayuda:** una franja fija «Paso 1 de 4 · Servicios» con lo que falta y un botón **«Siguiente paso»** cuando se completa.
- **Activar con texto, no con un círculo mudo:** botón «Activar» con tres estados (ver Fase 5).
- **Todo lo ya hecho se confirma** («Hecho: 2 servicios activos») y lleva a «Revisar».

---

## 4. Fases

Orden por impacto ÷ riesgo. Cada fase: se implementa → se prueba en local con cuentas de prueba → te la enseño → **solo con tu «continúa con la fase N»** pasa a la siguiente. Despliegue (rama `auditoria/ux-movil-onboarding-profesional`, PR, CI) solo cuando lo pidas.

### Fase 1 — Encabezados apilados sin solaparse (fallos 3, 5a, 1, 2) · riesgo medio

Causa única, arreglo único:

1. `Navbar` publica su altura real en una variable CSS (`--app-navbar-h`, con `ResizeObserver`) y la retira al desmontarse. Nuevo hook pequeño `useNavbarOffset`.
2. `AppHeader` pega **debajo** del `Navbar` (`top: var(--app-navbar-h, 0px)`), con `z-30` (el `Navbar`, `z-40`, nunca queda tapado), y solo suma el margen del notch cuando no hay `Navbar` encima (`--app-header-pad`).
3. `index.css`: `html { scroll-padding-top: calc(var(--app-navbar-h, 0px) + var(--app-sticky-sub-h, 0px)) }` → anclas, foco de teclado y `scrollIntoView` no aterrizan bajo la barra.
4. Progreso del alta (empresa y jardinero) en una **franja fija bajo el `Navbar`** (componente común, `top: var(--app-navbar-h)`), siempre visible. Mismo patrón en los dos altas.
5. Páginas de estado (`/status`, `/empresa/estado`): quitar el `min-h-screen`/`80vh` que suma altura al `Navbar`; el contenido arranca bajo él.
6. `docs/design-system.md` §5: «el `AppHeader` se pega bajo el `Navbar`; nunca dos barras con el mismo `top`».

Pruebas locales: las **6 pantallas con `AppHeader`** (Mis reservas, Chat, Mi cuenta, Disponibilidad, panel de empresa con sus 4 pestañas, Mi trabajo de empleado) con scroll a 0 / medio / final, a 320, 375 y 430 px, con jardinero, empresa y empleado; el menú hamburguesa abierto; los dos altas paso a paso; las dos páginas de estado. Se mide `getBoundingClientRect` del `Navbar` y del `AppHeader` (no se pisan) y se comprueba por captura.
Tests: `AppHeader` y `Navbar` (variable CSS puesta/retirada, sin `ResizeObserver`).

> **Lo que NO puedo verificar yo:** el 1 y el 2 nacieron en el iPhone con la web instalada y no se reproducen en el emulador. La Fase 1 los cierra de forma que no depende de la causa exacta, pero **necesito que los confirmes en tu móvil** tras desplegar.

### Fase 2 — «Actualizar estado» de la solicitud (fallo 6) · riesgo bajo-medio

- Botón `RefreshButton` («Actualizar estado») en `GardenerStatusPage` y `CompanyStatusPage`, con mensaje claro: «Sigue en revisión» / «¡Aprobada! Entrando…» y redirección automática si ya está aprobada.
- Empresa: `useCompanyOnboarding().refresh()`. Jardinero: `App.tsx` expone `refreshApplicationStatus` (la misma función `fetchStatus`) y la pasa como prop.
- (Opcional, ver pregunta 4) releer solo al volver a la app desde segundo plano (`visibilitychange`), para que no haga falta ni pulsar.

Pruebas: cuenta jardinero y empresa en revisión → aprobar desde SQL/admin → pulsar → entra al panel sin cerrar sesión; pulsar sin cambios → mensaje «sigue en revisión»; sin red → error con reintento.

### Fase 3 — «Confirmar esta dirección» (fallo 4) · riesgo bajo-medio

- `CoverageTab`: si hay dirección pero **no hay coordenadas operativas**, el aviso ámbar pasa a un bloque con el texto «Falta confirmar tu zona de trabajo» y un botón primario **«Confirmar esta dirección»** (con el radio visible) que llama al guardado existente. Al guardar: aviso verde «Zona confirmada», el botón desaparece y el paso de la ayuda pasa a «Hecho».
- Si la dirección no se puede localizar: mensaje claro («Elige una de las direcciones sugeridas») y el botón sigue ahí.
- Solo la primera vez (sin coordenadas); después manda el guardado automático de siempre.

Pruebas: cuenta `jardin-nuevo` (dirección sin coordenadas) → confirmar → comprobar en BD las coordenadas y que `my_provider_setup_status` marca `has_coordinates`; dirección inválida; empresa (`/empresa/configuracion`, misma pantalla).

### Fase 4 — Horario base sin preconfigurar (fallo 5b) · riesgo medio

- `startHour`/`endHour` empiezan **vacíos** («Elige hora»); pulsar días no pinta horas hasta elegir las dos; con días marcados y sin franja, mensaje: «Elige también de qué hora a qué hora». Los horarios ya guardados se siguen cargando igual.
- Selectores a 16 px (hallazgo extra).

Pruebas: cuenta nueva sin horario; con horario guardado (`jardinero.local`: debe cargar idéntico); empleado (`member`); guardar y comprobar `recurring_schedules` en BD. Tests de `RecurringScheduleManager` (ya hay).

### Fase 5 — Activar servicios con texto y estados (fallo 7.1) · riesgo medio-alto

- Un componente `ServiceActivateButton` con tres estados, usado en «Mi perfil → Servicios» **y** en el apartado de ayuda:
  - **Gris muy claro** — no se puede activar todavía (falta el precio / configuración incompleta). Sigue siendo tocable: lleva al configurador con el aviso de qué falta (no queda un botón muerto).
  - **Gris más oscuro** — configurado y se puede activar: «Activar».
  - **Verde con «Activado»** — activo.
- Apartado de ayuda, paso «Servicios y precios»: si hay servicios configurados sin activar → «Tienes **2 servicios configurados pero sin activar**» con un acceso directo y los botones «Activar» ahí mismo; si no hay ninguno configurado, el texto actual.
- Activar desde la ayuda reutiliza exactamente lo que hace hoy el círculo (`gardener_service_prices.active` + `gardener_profiles.services`), sin tocar el contenido de la configuración. La validez usa los mismos validadores (`src/utils/serviceValidation.ts`).
- `ProfileSettings.tsx`: solo se añade el cálculo «¿se puede activar?» y se pasa a `ServicesTab`; nada más.

Pruebas: los **7 servicios** (uno por uno: sin configurar → configurar → activar → desactivar), en Mi perfil y en la ayuda; fitosanitarios y desbroce con herbicida (carnet); que la lista de «Profesionales» (`scripts/provider-setup/verify-provider-setup.mjs`) siga coincidiendo con lo que dice la ayuda; empresa.

### Fase 6 — Primeros pasos guiados (fallo 7.2) · riesgo medio

6a. **Panel del jardinero y de la empresa:** con obligatorios pendientes, la ayuda va primero; paso actual desplegado con «Qué tienes que hacer» numerado; el resto plegado.
6b. **Destinos con contexto:** franja «Paso X de N» en Servicios, Zona, Horario (y Equipo en empresa) con lo que falta y «Siguiente paso» al completarlo; tras guardar un configurador válido de un servicio apagado, aviso «Listo. ¿Lo activas ahora?».
6c. **Textos:** pasada de lenguaje llano a los títulos y detalles de `providerSetup.ts` (un solo sitio) y a los avisos de los configuradores; estados vacíos útiles («Todavía no has elegido ningún servicio. Empieza por el que más haces»).

Pruebas: recorrido completo con cuenta nueva (jardinero y empresa) hasta «Ya apareces a los clientes», comprobando que cada paso se marca solo al completarse y que ninguno obliga a adivinar. Tests de `providerSetup.ts` y `ProviderSetupChecklist` (ya existen).

---

## 5. Decisiones que necesito de ti

1. **El «check» del 7.1.** Lo entiendo como el círculo de «Mi perfil → Servicios» (el que activa) y lo cambio por el botón «Activar» de tres estados, **y** lo mismo dentro de la ayuda. ¿Es eso?
2. **Fase 6a:** mientras falte algo obligatorio, ¿pongo la ayuda **encima** de los 6 atajos del panel (recomendado) o prefieres ocultar los atajos hasta terminar?
3. **Antelación mínima (24 h) y semanas a mantener (4):** ¿también sin preconfigurar o las dejo?
4. **Fase 2:** ¿solo el botón, o también releer solo al volver a la app?

## 6. Cuentas de prueba locales (ya creadas, solo en la base local)

| Cuenta | Para |
|---|---|
| `jardinero.local@test.local` | Jardinero completo (7 servicios, horario): que nada cambie |
| `jardin-nuevo.ux@test.local` | Jardinero aprobado, sin servicios, dirección sin coordenadas (fallos 4, 5b, 7) |
| `empresa-borrador.ux@test.local` | Empresa en alta (progreso, fallo 1) |
| `empresa-enviada.ux@test.local` | Empresa en revisión (fallos 2 y 6) |
| `admin.local@test.local` | Aprobar solicitudes |
| (por crear) empresa aprobada y empleado | Fase 1 (panel con pestañas, Mi trabajo) |

Contraseña de todas: la de la semilla local (`Test123456!`). Solo existen en la base local.

## 7. Acciones manuales del usuario

Hasta ahora: **(nada que desplegar)**, no se ha tocado código. En cada fase desplegada se añadirá aquí: fases 1-6 son solo front (Vercel); **ninguna lleva migración ni función** salvo que en la Fase 5 decidamos mover la regla «configurado pero sin activar» al servidor (no se propone).
