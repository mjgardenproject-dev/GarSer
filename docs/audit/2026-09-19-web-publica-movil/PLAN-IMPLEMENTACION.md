# Plan de implementación — Fallos UX web pública/móvil (2026-09-19)

**Origen**: 9 fallos reportados por el usuario navegando garser.es desde el móvil (PWA),
sin sesión — página de registro/login, home pública y encabezado público.

**Skill**: `garser-ux-movil` en exclusiva. No se usa `diseno-web-cliente`.

**Estándar a seguir**: `docs/design-system.md` (único documento vivo de diseño en este
repo; `docs/ux-patterns.md` y `docs/ux-checklist.md` no existen todavía). Cada fase cita
qué parte del documento sigue o, si introduce un patrón nuevo, lo deja anotado para
añadirlo al documento.

**Hallazgos nuevos encontrados durante la investigación**: ver
[`HALLAZGOS-NUEVOS.md`](HALLAZGOS-NUEVOS.md) (H-01 a H-04). Ninguno se corrige en este
plan salvo H-02 (logo roto en `Navbar.tsx`), que se resuelve como efecto colateral de la
Fase 1 porque comparte causa exacta con el punto 1 del usuario.

**Fuera de este plan por completo**: lógica de reserva/precios/disponibilidad,
autenticación como flujo, `/para-jardineros` (`GardenersLandingPage.tsx`, solo se enlaza
a ella), y todo lo listado en `HALLAZGOS-NUEVOS.md` como "no se corrige en esta ronda".

**Alcance de `/marbella`**: `MarbellaLandingPage.tsx` reutiliza el mismo componente que
la Home (`CustomerExperienceSections`). Los puntos 6, 7 y 8 del usuario (copy de la
tarjeta principal, cobertura y CTA final) son específicos de la Home pública — Marbella
conserva su copy actual sin cambios en esos tres puntos. Los puntos 1-5 y 9 (logo,
ancho de auth, cabecera, "Acceder" duplicado, scroll) son transversales y sí se aplican
también a Marbella, donde corresponda.

---

## Orden y razonamiento

Fases 1-3 son infraestructura de bajo riesgo, sin juicio de diseño, independientes entre
sí: arreglan un asset roto (con un componente reutilizable nuevo), un bug transversal de
navegación y un bug de layout. Se hacen primero porque no dependen de nada y la Fase 4
consume el componente de logo que crea la Fase 1. La Fase 4 es la única de riesgo
medio (toca un prop compartido entre dos páginas). Las Fases 5-7 son evolución de
contenido de la Home, en el mismo orden en que aparecen al hacer scroll, cada una
independiente y revertible por separado.

---

## Fase 1 — Logo oficial de GarSer, componente reutilizable

**Hallazgos que cierra**: punto 1 (logo en auth), punto 3 (logo en header público), H-02.

**Causa raíz**: `AuthForm.tsx:357` y `Navbar.tsx:132` referencian `/garser-logo.svg`,
un archivo que **nunca ha existido** en `public/` (confirmado con `git log --follow`,
sin resultado) — ambos caen siempre al fallback de texto "GarSer.es". `PublicHeader.tsx`
no usa ninguna imagen: monta un icono "G" + texto a mano.

**Entregables**:
1. Recortar el logo oficial (`logo garser final.png`, cuadrado 2000×2000 con mucho
   margen en blanco) a un wordmark ajustado (1285×295 aprox.) y publicarlo como
   `public/garser-logo.png` — optimizado a ~50 KB.
2. **Nuevo componente reutilizable** `src/components/common/GarserLogo.tsx`: envuelve
   el patrón `<img src="/garser-logo.png" onError={...}>` + fallback de texto
   "GarSer.es" que hoy está **duplicado a mano** en `AuthForm.tsx` y `Navbar.tsx` (el
   mismo problema de "6 modales de confirmación copiados a mano" que ya señala
   `design-system.md` §1, pero con el logo). Acepta `className` (tamaño) para que cada
   sitio lo use a su escala sin repetir la lógica de error.
3. `AuthForm.tsx`: sustituir el bloque de logo (líneas ~349-363) y el estado
   `logoError` (línea 108) por `<GarserLogo className="h-16 w-auto mx-auto" />`.
4. `Navbar.tsx`: sustituir el bloque equivalente (líneas ~120-134) por
   `<GarserLogo className="h-8 w-auto" />`.
5. `PublicHeader.tsx`: sustituir el icono "G" + texto (líneas 10-15) por
   `<GarserLogo className="h-8 w-auto" />` — mismo tamaño que `Navbar.tsx`, para que el
   header público y el del jardinero se vean con el mismo peso visual.

**Riesgo**: bajo. Solo sustituye un asset roto por uno real, extrayendo una lógica ya
duplicada a un componente — no cambia comportamiento salvo hacer visible el logo real
donde hoy solo se ve texto.

**Cómo se verifica**: cargar `/auth`, `/`, `/marbella`, `/para-jardineros` y (con
sesión) el dashboard del jardinero; confirmar que el logo real se ve en los cuatro
contextos y a los tamaños correctos. Comprobar en `read_network_requests` que
`/garser-logo.png` responde 200. Probar el fallback forzando un 404 temporal (renombrar
el archivo) para confirmar que el texto sigue apareciendo si la imagen fallara.

---

## Fase 2 — Restaurar el scroll al cambiar de página (transversal)

**Hallazgos que cierra**: punto 9.

**Causa raíz**: `src/main.tsx:11` monta `BrowserRouter` pero no hay ningún componente
que reaccione a los cambios de ruta reseteando el scroll — React Router no lo hace
solo. Si la página anterior estaba scrolleada, la nueva aparece en la misma posición.

**Entregables**:
1. Nuevo `src/components/common/ScrollToTop.tsx`: `useLocation()` +
   `useEffect(() => window.scrollTo(0, 0), [pathname])`. No renderiza nada.
2. Montarlo una vez dentro de `AppContent` en `src/App.tsx` (dentro del contexto del
   Router, antes de `<Routes>`), para que cubra las 40+ rutas de la app — cliente,
   jardinero y admin por igual.

**Riesgo**: bajo. Aditivo, sin lógica de negocio, no depende de sesión ni de rol.

**Cómo se verifica**: en el preview, hacer scroll hasta el final de una página larga
(p. ej. la Home), navegar a otra (p. ej. `/marbella` o, con sesión, `/account`), y
confirmar que la nueva página aparece arriba del todo. Repetir con navegación hacia
atrás del navegador.

---

## Fase 3 — `/auth` a ancho completo, sin margen de "tarjeta"

**Hallazgos que cierra**: punto 2.

**Causa raíz**: no está en `AuthForm.tsx` (que ya no tiene ninguna tarjeta con borde o
sombra envolviendo el formulario). Está en `src/App.tsx:276-282`: el `<main>` que
envuelve todas las rutas aplica `mx-auto max-w-full px-3 ... sm:max-w-7xl sm:px-6` a
`/auth` porque esa ruta no está en la lista de páginas a ancho completo (solo lo están
home/marbella/reserva vía `isBookingPage || isMarketingPage`). Ese `px-3` deja un
margen alrededor del `min-h-screen bg-white` propio de `AuthForm`, que se percibe como
"tarjeta blanca sobre fondo blanco". Esto además **incumple** `design-system.md` §9:
*"en el breakpoint base el contenido ocupa el 100% del ancho disponible"*.

**Entregables**:
1. `src/App.tsx`: añadir `isAuthPage` a la condición que decide el `<main>` a ancho
   completo (`isBookingPage || isMarketingPage || isAuthPage ? 'w-full pb-16 sm:pb-0' : ...`).

**Riesgo**: bajo. Una condición booleana; no cambia ninguna otra ruta. `/reset-password`
y `/confirmar-servicio` (que comparten `isAuthPage`) gestionan su propio
`min-h-screen`/centrado, así que tampoco se ven afectadas negativamente — se confirma
en la verificación.

**Cómo se verifica**: `/auth` en 375px y en escritorio, confirmar que el blanco llega a
los dos bordes sin margen gris. Revisar también `/reset-password` y
`/confirmar-servicio` (comparten la misma condición) para confirmar que no quedan
peor que antes.

---

## Fase 4 — Cabecera pública: "Reservar" funcional y verde, quitar "Acceder" duplicado

**Hallazgos que cierra**: punto 4, punto 5.

**Causa raíz (punto 4)**: `PublicHeader.tsx:27` y `:46` son `<a href="#reserva">`. Ese
`id` solo existe en `CustomerExperienceSections.tsx:51` (Home/Marbella) — en
`/para-jardineros` no existe nada con ese id, así que el clic no hace nada.

**Causa raíz (punto 5)**: `CustomerExperienceSections.tsx:71-79` muestra un botón
"Acceder" dentro de la tarjeta de hero, redundante con el que ya está siempre visible
en `PublicHeader.tsx` (línea 17-23 en móvil, 36-42 en escritorio).

**Entregables**:
1. `PublicHeader.tsx`: sustituir los dos `<a href="#reserva">` por un `<button>` que
   ejecuta la misma acción que el CTA principal de la Home (`clearBookingResumeStorage`
   + `navigate('/reservar?start=1')`, ya definida en `PublicHomePage.tsx` y
   `MarbellaLandingPage.tsx` como `handleNewBooking`) — se implementa directamente en
   `PublicHeader.tsx` para no tener que pasar la función por props desde 3 páginas
   distintas.
   - Estilo: reutiliza la forma del pill "Acceder" ya existente (mismo
     `rounded-full`/padding/gap), pero en `bg-emerald-700 hover:bg-emerald-800
     text-white` en vez del degradado documentado en `design-system.md` §3.1 — ese
     degradado no pasa contraste WCAG AA (ver H-01); `emerald-700` sí (5.5:1). Se deja
     anotado como el estándar a seguir si se necesita otro botón de acción verde en
     cabeceras.
2. `CustomerExperienceSections.tsx`: quitar el bloque `showAccessCta && onAccessCta`
   (líneas 71-79) y el prop `showAccessCta`/`onAccessCta` del tipo del componente.
3. `PublicHomePage.tsx` y `MarbellaLandingPage.tsx`: quitar el paso de `showAccessCta`
   y `onAccessCta` al montar `<CustomerExperienceSections>`.
4. `src/config/publicSiteContent.ts`: quitar `accessCtaLabel` de `generalHomeContent`
   (deja de usarse en ningún sitio tras el punto 2).

**Riesgo**: medio — es la única fase que toca un prop compartido por dos páginas
(`PublicHomePage` y `MarbellaLandingPage`) y un componente de navegación presente en
las 4 páginas públicas. El cambio es mecánico (quitar, no reestructurar) y cada punto
es independiente del otro dentro de la fase.

**Cómo se verifica**: desde `/para-jardineros`, `/marbella` y `/` pulsar "Reservar" en
la cabecera (desktop y fila de chips móvil) y confirmar que en los tres casos aterriza
en `/reservar?start=1` con el wizard visible. Confirmar visualmente que el botón es
verde y se distingue del "Acceder" oscuro. Revisar el primer pliegue de Home y Marbella
en 390×844 para confirmar que la tarjeta de hero ya no repite "Acceder".

---

## Fase 5 — Home: tarjeta principal más clara

**Hallazgos que cierra**: punto 6. Solo Home general (`pageVariant === 'general'`).

**Entregables**:
1. `src/config/publicSiteContent.ts`: cambiar `generalHomeContent.title` de
   *"Servicios de jardinería en Marbella, Estepona y Costa del Sol"* a **"Descubre
   cuánto cuesta y cuándo hay disponibilidad para tu jardín"**. Quitar
   `generalHomeContent.description` (o dejarlo sin usar en este variant).
2. `CustomerExperienceSections.tsx:47`: renderizar el párrafo de descripción solo si
   `!isMarbella` es falso para Home... es decir, **solo cuando `isMarbella` sea
   `true`** (Marbella conserva su descripción actual tal cual); en Home general el
   párrafo no se pinta.

**Riesgo**: bajo. Solo copy y un condicional de render ya existente en el mismo
componente (`isMarbella` ya se calcula en la línea 35).

**Cómo se verifica**: comparar Home y Marbella en 390×844 antes/después — Home pierde
el subtítulo y cambia el titular; Marbella queda pixel a pixel igual.

---

## Fase 6 — Home: "Encuentra jardineros en tu zona"

**Hallazgos que cierra**: punto 7. Solo Home general.

**Entregables**:
1. `src/config/publicSiteContent.ts`: añadir a `marbellaContent` los campos
   `coverageTitle`/`coverageDescription` con el texto **actual** de
   `generalHomeContent` ("Cobertura orientada a la Costa del Sol" + su descripción),
   para que Marbella no cambie. Cambiar `generalHomeContent.coverageTitle` a
   **"Encuentra jardineros en tu zona"** y su descripción a un texto que explique que
   GarSer trabaja con jardineros reales en las zonas ya listadas.
2. `CustomerExperienceSections.tsx:158-159`: leer `hero.coverageTitle` /
   `hero.coverageDescription` (variable `hero` ya definida en la línea 36) en vez de
   `generalHomeContent.coverageTitle` fijo — así cada variante muestra su propio texto.
3. Añadir un botón "Buscar jardineros en mi zona" dentro de ese bloque, reutilizando el
   estilo del CTA primario ya usado en la misma sección (`onPrimaryCta`) — dispara la
   misma acción de iniciar reserva, que es como realmente se encuentra un jardinero
   disponible en una zona concreta.

**Riesgo**: bajo. Copy + un botón que reutiliza una acción ya existente (`onPrimaryCta`,
ya recibido como prop). No introduce ningún componente ni patrón nuevo.

**Nota**: la foto de esta sección sigue rota en producción (H-03, ajeno a este plan) —
el texto quedará correcto pero el hueco de imagen seguirá mostrando el degradado de
marca hasta que se suba el archivo a Supabase Storage.

**Cómo se verifica**: comparar Home y Marbella antes/después — Home muestra el nuevo
título/CTA, Marbella queda igual que hoy. Pulsar el nuevo botón y confirmar que navega
al wizard de reserva.

---

## Fase 7 — Home: CTA final "¿Eres jardinero?"

**Hallazgos que cierra**: punto 8. Solo Home general.

**Entregables**:
1. `src/config/publicSiteContent.ts`: añadir a `generalHomeContent` los campos para el
   nuevo bloque: `gardenerCtaBadge` ("¿Eres jardinero?"), `gardenerCtaTitle`,
   `gardenerCtaDescription`, `gardenerCtaButtonLabel` ("Ver ventajas para jardineros").
   `marbellaContent.finalCtaTitle`/`finalCtaDescription` no se tocan.
2. `CustomerExperienceSections.tsx:186-214`: cuando `pageVariant === 'general'`,
   sustituir la insignia "Reserva más clara" + título/descripción/botones de reserva
   por la nueva insignia + título + descripción + un único `<Link to="/para-jardineros">`
   (importar `Link` de `react-router-dom`, hoy no importado en este archivo) estilizado
   igual que el botón blanco que ya usa este mismo bloque (línea 199). Cuando
   `pageVariant === 'marbella'`, el bloque se renderiza exactamente como hoy.
3. Import nuevo de icono `Briefcase` (lucide-react, ya usado en `AuthForm.tsx` para el
   selector de rol jardinero — mismo icono, mismo significado, coherente en toda la
   web) en vez de `CheckCircle2` para la insignia de este bloque.

**Riesgo**: bajo. Copy + un enlace a una ruta ya existente y fuera de este alcance de
edición (`/para-jardineros`). El bloque de Marbella queda intacto por el condicional de
variante.

**Cómo se verifica**: Home muestra el nuevo bloque con el enlace a
`/para-jardineros` (confirmar que navega ahí, no que renderiza esa página aquí);
Marbella conserva su CTA final de reserva actual sin cambios.

---

# Segunda tanda (2026-09-19, antes del PR) — jardineros y alcance geográfico

**Origen**: 3 fallos nuevos reportados por el usuario tras revisar la primera tanda,
antes de abrir el PR. Mismo procedimiento (`garser-ux-movil`, sin `diseno-web-cliente`).

**Decisión de posicionamiento (la fija el usuario, no es una interpretación mía)**:
GarSer es un marketplace de jardinería sin límite geográfico dentro de España (la única
limitación real es el idioma). Costa del Sol es la **zona de lanzamiento** por tener
mayor demanda puntual de jardinería, no el ámbito del negocio. Consecuencia directa:
la Home y la landing de jardineros dejan de mencionar Costa del Sol como si fuera el
alcance del servicio; esa mención se traslada a una página propia de SEO local nueva.

**Investigación previa a este plan**:
- Leído `GardenersLandingPage.tsx` completo y mapeadas todas las referencias a "Costa
  del Sol"/`costaDelSolZones` en el código público (`publicSiteContent.ts`,
  `PublicHomePage.tsx`, `CustomerExperienceSections.tsx`, `PublicFooter.tsx`).
- Verificados contra el código real (no supuestos) los beneficios de GarSer para un
  jardinero antes de escribir ningún copy: pago seguro vía Stripe con comisión del
  12,5% ya persistida (`bookingAmounts.ts`), presupuesto con fotos y Gemini sin visita
  previa (flujos de análisis IA ya en producción), disponibilidad y agenda
  automatizadas (`AvailabilityManager.tsx`, `RecurringScheduleManager.tsx`), perfil
  público con reseñas reales de cliente (`GardenerPublicProfile.tsx` +
  `ReviewList.tsx`), chat integrado sin compartir teléfono (`ChatList.tsx`,
  `ChatWindow.tsx`).
- Consultada la skill `programmatic-seo`: el patrón "servicio en ciudad" es el playbook
  "Locations", validado y estándar. Aviso propio de la skill a respetar: cada página de
  ciudad necesita contenido realmente distinto (textos, FAQ, zonas), no una plantilla
  con el nombre cambiado — si no, penaliza como contenido fino.
- Precedente ya existente en el propio repo: `MarbellaLandingPage.tsx` **ya es** una
  instancia de exactamente este patrón — una página fina que pasa
  `pageVariant="marbella"` al mismo `CustomerExperienceSections` que usa la Home, con su
  propio bloque de contenido (`marbellaContent`). La Fase 10 generaliza ese patrón en
  vez de crear un componente nuevo, así que añadir la próxima ciudad (Estepona,
  Málaga...) queda reducido a: un objeto de contenido + una ruta + una página de ~20
  líneas — no diseño nuevo. Responde directamente a la pregunta del usuario ("¿se puede
  automatizar?"): sí, y esta fase construye el mecanismo.
- Palabras clave usadas por criterio propio (no hay herramienta de volumen de búsqueda
  conectada a este proyecto): "portal para jardineros", "trabajo para jardineros
  autónomos", "conseguir clientes de jardinería", "jardinería Costa del Sol",
  "jardineros Costa del Sol", "corte de césped/poda de setos/palmeras + Costa del Sol".
  Es criterio razonado, no un dato de volumen verificado — lo digo explícito para no
  presentar una suposición como si fuera una medición.

---

## Fase 8 — Quitar el enfoque "Costa del Sol" de Home y del footer compartido

**Hallazgos que cierra**: punto 2 (parte Home). No toca `/marbella` (su enfoque
Costa del Sol es intencionado, es una landing local) ni `GardenersLandingPage.tsx`
(eso es la Fase 9).

**Entregables**:
1. `publicSiteContent.ts` — `pageSeo.general`: título y descripción sin nombres de
   ciudad ("Servicios de jardinería a domicilio | GarSer" / una descripción centrada en
   precio y disponibilidad claros, sin "Marbella, Estepona y Costa del Sol").
2. `publicSiteContent.ts` — `generalHomeFaqs`, pregunta "¿En qué zonas trabaja GarSer?":
   respuesta honesta y no exclusionaria — GarSer no está limitado a una zona por
   diseño; hoy la mayor disponibilidad de jardineros está en la Costa del Sol (zona de
   lanzamiento) y se va ampliando. No se afirma cobertura nacional real que hoy no
   existe operativamente.
3. `CustomerExperienceSections.tsx` — sección "Encuentra jardineros en tu zona"
   (`pageVariant === 'general'`): quitar las chips de `costaDelSolZones.map(...)` (listan
   ciudades de la Costa del Sol) y reescribir `generalHomeContent.coverageDescription`
   sin nombrarlas ("Indica tu dirección al reservar y te mostramos qué jardineros
   profesionales están disponibles cerca de ti"). El botón "Buscar jardineros en mi
   zona" se mantiene. Marbella no se ve afectada por este cambio: sigue mostrando sus
   propias chips, ya que su enfoque local es intencionado. *(El enlace a la página
   Costa del Sol se añade en la Fase 10, cuando esa ruta exista — añadirlo aquí dejaría
   un enlace roto si esta fase se desplegara sola antes que la 10.)*
4. `PublicHomePage.tsx` — JSON-LD de `Organization`: quitar `areaServed:
   costaDelSolZones`. No se sustituye por una cobertura nacional (no sería cierto
   operativamente); se omite el campo, que es válido en schema.org.
5. `PublicFooter.tsx` — el bloque "Cobertura orientativa" (chips de
   `costaDelSolZones`) pasa a ser opcional vía una prop nueva `showCoverageZones?:
   boolean` (por defecto `false`). Se activa explícitamente solo desde
   `MarbellaLandingPage.tsx` (Fase existente, sin cambios de comportamiento) y desde la
   nueva página de la Fase 10. Home y jardineros dejan de mostrarlo.
6. **Hallazgo nuevo encontrado en este footer, se corrige de paso**: el enlace
   "Empezar reserva" (`PublicFooter.tsx:39`) es el mismo patrón de ancla rota
   `<a href="#reserva">` que ya se corrigió en `PublicHeader.tsx` en la Fase 4, pero
   aquí se quedó sin tocar — mismo bug, incluido enlace inerte en `/para-jardineros`.
   Se sustituye por el mismo patrón ya estandarizado (botón que limpia el borrador y
   navega a `/reservar?start=1`). Se documenta también en `HALLAZGOS-NUEVOS.md` (H-05)
   por transparencia, aunque se corrija aquí mismo.

**Riesgo**: medio — `PublicFooter.tsx` es compartido por Home, Marbella y Jardineros
(y la nueva página); el cambio es aditivo (prop con valor por defecto que preserva el
comportamiento de Marbella) pero hay que verificar las 4 páginas, no solo la Home.

**Cómo se verifica**: Home y `/para-jardineros` ya no muestran ningún nombre de ciudad
de la Costa del Sol (ni en el JSON-LD, comprobable en el DOM). Marbella conserva sus
chips de cobertura en el footer exactamente igual que hoy. El enlace "Empezar reserva"
del footer navega a `/reservar?start=1` desde las tres páginas, incluida
`/para-jardineros` donde antes no hacía nada.

---

## Fase 9 — Página de jardineros: mensaje principal, beneficios reales y SEO

**Hallazgos que cierra**: puntos 1.1 y 1.2 (íntegros), y la parte de punto 2 específica
de `/para-jardineros`.

**Entregables**:
1. `publicSiteContent.ts` — `gardenersContent.title`: de *"GarSer para jardineros que
   quieren captar nuevas reservas en Costa del Sol"* a **"El portal para jardineros que
   te ahorra tiempo y dinero en cada presupuesto"** — sin Costa del Sol, con la palabra
   clave "portal para jardineros" integrada de forma natural (no forzada), y apuntando
   a un problema real (el tiempo/coste de presupuestar) en vez de solo "conseguir
   reservas".
2. `gardenersContent.description`: reescrita para explicar el problema concreto que
   resuelve GarSer (visitas solo para presupuestar, pagos perseguidos, agenda a mano) en
   vez de la descripción genérica actual.
3. `gardenersContent.benefits`: de 3 tarjetas genéricas a **6 beneficios reales**,
   cada uno con su propio icono (hoy las 3 tarjetas repiten el mismo icono
   `Briefcase` en las tres — se corrige de paso):
   - Presupuestos con fotos, sin visitas previas (IA de GarSer)
   - Cobra siempre, sin perseguir pagos (Stripe, antes del trabajo)
   - Tu agenda, bajo control (disponibilidad automática, sin llamadas)
   - Reputación que se construye sola (perfil público + reseñas reales)
   - Habla con el cliente sin dar tu número (chat integrado)
   - Comisión clara desde el primer momento (12,5%, sin sorpresas)

   Cada beneficio lleva un `icon` (clave de texto) en el propio dato de
   `publicSiteContent.ts`; `GardenersLandingPage.tsx` mapea esa clave a un icono real de
   `lucide-react` (`Camera`, `ShieldCheck`, `CalendarCheck`, `Star`, `MessageCircle`,
   `Percent`) — mismo patrón de separación contenido/presentación que ya usa el resto
   del archivo.
4. `GardenersLandingPage.tsx` — el grid de beneficios pasa de `md:grid-cols-3` (3
   tarjetas, se veía descompensado) a `sm:grid-cols-2 lg:grid-cols-3` (6 tarjetas, dos
   filas de tres en escritorio, mejor distribuido).
5. `pageSeo.gardeners`: título y descripción reescritos sin "Costa del Sol", con
   términos de búsqueda reales de quien busca unirse ("portal para jardineros",
   "conseguir clientes de jardinería", "trabajo para jardineros autónomos").
6. `gardenersFaqs`: se añaden 2 preguntas orientadas a búsqueda ("¿Qué es GarSer para
   jardineros?", "¿Cómo consigo clientes de jardinería con GarSer?") — refuerzan el
   FAQPage schema ya implementado y responden a intención de búsqueda real, no
   palabras sueltas sin contexto.
7. `gardenersContent.benefits[2]` (antes "Cobertura local", con la mención a Costa del
   Sol) queda sustituida por completo por la lista nueva del punto 3 — no requiere un
   cambio aparte.

**Riesgo**: bajo. Todo el cambio vive en una página aislada
(`GardenersLandingPage.tsx`) y su bloque de contenido — no comparte componente con
Home ni Marbella (a diferencia de `CustomerExperienceSections`).

**Cómo se verifica**: `/para-jardineros` sin ninguna mención a Costa del Sol; 6
tarjetas de beneficios con iconos distintos y bien repartidas en el grid a 1024px y a
375px; título de pestaña y meta description nuevos (inspeccionar `<title>` y
`meta[name=description]` en el DOM); las 5 FAQ (3 actuales + 2 nuevas) se renderizan y
aparecen en el JSON-LD de `FAQPage`.

---

## Fase 10 — Página nueva "GarSer en la Costa del Sol" (SEO local) + patrón reutilizable por ciudad

**Hallazgos que cierra**: punto 2 (parte de la página nueva) y la pregunta de
automatización.

**Entregables**:
1. `CustomerExperienceSections.tsx` — generalizar el patrón que ya usa Marbella:
   - `pageVariant` gana un tercer valor real: `'costa-del-sol'`.
   - Nueva prop opcional `locationLabel?: string`. Cuando está presente, el título de
     la sección de servicios pasa de "Trabajos habituales para viviendas con jardín" a
     `Servicios disponibles para ${locationLabel}`, y cada tarjeta de servicio pasa de
     `{service.title}` a `{service.title} en ${locationLabel}` — esto es lo que genera
     los encabezados que pide el usuario ("Corte de césped en la Costa del Sol", "Poda
     de setos en la Costa del Sol"...) sin duplicar la lista de 7 servicios
     (`serviceHighlights` se queda genérica, la etiqueta de ubicación se añade solo en
     el render).
   - La sección de cobertura y el CTA final pasan a elegir contenido por variante
     (`marbellaContent` / `costaDelSolContent` / `generalHomeContent`) en vez del actual
     `isMarbella ? ... : ...` binario.
   - Solo se usa `locationLabel` desde la nueva página; Home y Marbella no pasan la
     prop y su render no cambia.
2. `publicSiteContent.ts` — nuevo bloque `costaDelSolContent` (mismo shape que
   `marbellaContent`: eyebrow, title, description, coverageTitle, coverageDescription,
   finalCtaTitle, finalCtaDescription) con copy real de Costa del Sol — aquí sí tiene
   sentido nombrar Marbella, Estepona, etc., porque es precisamente el propósito de
   esta página. Nuevo `costaDelSolFaqs` (3-4 preguntas: cobertura real por zona, si
   compite con la landing de Marbella — no, es la vista general de toda la comarca,
   Marbella queda como landing propia dentro de ella —, precios orientativos). Nueva
   entrada `pageSeo.costaDelSol` (título/descripción con "jardinería Costa del Sol",
   `path: '/costa-del-sol'`). Nuevas claves en `MarketingImageSlotKey` y
   `marketingImageSlots` para el hero y el `og:image` de esta página (siguiendo la
   convención ya usada para Marbella/jardineros).
3. Nueva página `src/pages/public/CostaDelSolLandingPage.tsx` — mismo patrón exacto que
   `MarbellaLandingPage.tsx` (SEO, JSON-LD con `WebPage`+`FAQPage`+`BreadcrumbList`,
   `PublicHeader`/`PublicFooter`), pasando `pageVariant="costa-del-sol"` y
   `locationLabel="la Costa del Sol"` a `CustomerExperienceSections`, y
   `showCoverageZones` a `PublicFooter` (mecanismo ya creado en la Fase 8).
4. `App.tsx` — nueva ruta `/costa-del-sol` con lazy-loading, mismo patrón que
   `/marbella` y `/para-jardineros`; se añade a `isMarketingPage` para que use el
   layout a ancho completo (mismo criterio ya usado por las otras landings públicas).
5. `public/sitemap.xml` — añadir `https://garser.es/costa-del-sol`.
6. Enlace de entrada: desde el footer (ya enlaza a Marbella/jardineros; se añade
   `/costa-del-sol` a la misma lista, visible en las 4 páginas públicas) y desde un
   enlace secundario nuevo en la sección "Encuentra jardineros en tu zona" de la Home
   ("¿Buscas cobertura en la Costa del Sol? Ver disponibilidad"), añadido aquí —no en
   la Fase 8— precisamente porque hasta esta fase la ruta no existe. Así la página no
   queda huérfana (checklist de `programmatic-seo`).

**Riesgo**: medio. Es la fase de mayor superficie (componente compartido con un tercer
branch, página nueva, ruta nueva), pero es **aditiva**: ninguna rama existente
(`general`/`marbella`) cambia su comportamiento porque `locationLabel` y el nuevo
`pageVariant` solo se activan desde el sitio nuevo.

**Nota sobre escalar a más ciudades**: con 2 ciudades (Marbella + Costa del Sol) el
`pageVariant` como enumerado cerrado todavía es manejable. Si en el futuro se añade una
tercera o cuarta ciudad, merece la pena revisar si conviene pasar de un enumerado fijo
a recibir el bloque de contenido completo como prop — se deja anotado aquí, no se hace
ahora porque con 2-3 variantes el enumerado actual sigue siendo la opción más simple, y
no hay que resolver un problema que todavía no existe.

**Cómo se verifica**: `/costa-del-sol` carga con título/FAQ propios, las 7 tarjetas de
servicio muestran "... en la Costa del Sol", el footer de esa página sí muestra las
chips de zona, y el enlace desde la Home llega correctamente. Confirmar que `/` y
`/marbella` no cambian su render (mismo `pageVariant` que antes, prop `locationLabel`
no se les pasa). `npx tsc --noEmit` limpio con el tercer branch añadido.

---

# Tercera tanda (2026-09-20) — funnel de reserva

**Origen**: 2 fallos reportados por el usuario en el formulario de reserva.

1. La página de detalles (paso 3) tiene demasiado contenido en móvil, con el espacio mal
   repartido; cuesta entender qué hay que hacer y qué se está haciendo.
2. La recarga de horarios y jardineros (paso 4) no está pulida visualmente: parece que la
   web va a tirones.

**Alcance y línea roja**: esto es diseño y mecánica de render. **No se toca ninguna regla
de negocio**: ni qué datos se piden, ni cuándo se piden, ni el motor de precios, ni el
cálculo de horas válidas o de disponibilidad. Refrescar los jardineros al cambiar de día
es correcto y se mantiene (el precio y la disponibilidad dependen de la fecha); lo que
cambia es **qué se pinta mientras llega la respuesta**.

**Hallazgos nuevos documentados**: H-06 a H-09 en [`HALLAZGOS-NUEVOS.md`](HALLAZGOS-NUEVOS.md).

**Limitación de verificación conocida**: el funnel de reserva necesita Supabase local
(servicios, jardineros, disponibilidad). Docker Desktop no está arrancado en esta máquina,
así que ahora mismo `/reservar` no es navegable en el preview. Para verificar estas tres
fases en vivo hace falta arrancar Docker y levantar Supabase local. Si no, la verificación
se queda en typecheck + tests + lectura de código, y así hay que declararlo: no se da una
fase por cerrada afirmando que se ha visto funcionar cuando no se ha podido.

---

## Fase 11 — Paso 3 (detalles): primer pliegue legible en móvil

**Cierra**: fallo 1.

**Diagnóstico** (reconstruido leyendo el JSX a 375 px de ancho, `DetailsPage.tsx:4523-4700`
y `ManualEntryChoice.tsx`): antes de poder hacer nada, el cliente atraviesa cabecera
"Detalles" (~57 px), barra de progreso (~45 px), y después el bloque que domina la
pantalla: la pregunta "¿Cómo quieres calcular tu presupuesto?" (`h2` de 18 px), un párrafo
de apoyo de dos líneas, y **dos tarjetas altas** (`grid-cols-2`, ~163 px de ancho cada una
a 375 px) con insignia, icono de 40 px, título en negrita que se parte en 3-4 líneas
("Prefiero introducir los datos manualmente") y descripción de 2-3 líneas. Solo después
llega el título real del servicio (otro `h2`) con su descripción, y por fin la tarea
("Añade tu zona de césped", `py-8` + icono de 48 px). Resultado: la decisión secundaria
—cómo introducir los datos— ocupa más espacio y más peso visual que la tarea principal, y
hay dos `h2` compitiendo en menos de 300 px.

**Entregables**:
1. `ManualEntryChoice.tsx`: compactar las dos tarjetas conservando las dos columnas (el
   `grid-cols-2` fue una compactación deliberada de una ronda anterior, no se revierte):
   icono más pequeño en línea con el título en vez de apilado, padding menor, y descripción
   a una línea. Objetivo: que el bloque baje de ~250 px a ~140 px sin perder claridad.
2. `strings.ts` (`MANUAL_ENTRY_STRINGS.choice`): acortar los títulos que provocan el
   partido feo a 163 px ("Prefiero introducir los datos manualmente" → algo como "Escribir
   los datos yo") y pasar el subtítulo tranquilizador ("Podrás cambiar de opción en
   cualquier momento...") a una nota de una línea debajo de las tarjetas, en texto menor.
   El texto completo no se pierde: cambia de sitio y de peso.
3. `DetailsPage.tsx:4632-4644`: resolver la duplicidad de encabezados. El `h2` del selector
   y el `h2` del servicio dicen dos cosas distintas en el mismo pliegue; el del servicio
   pasa a ser el encabezado principal de la tarea y el del selector baja de jerarquía.
4. Ritmo de espaciado: unificar los márgenes del bloque (`mb-6`/`mb-4`/`space-y-6`
   mezclados hoy) para que la separación entre "qué estoy eligiendo" y "qué tengo que
   hacer" sea legible de un vistazo.

**Riesgo**: bajo-medio. Es un archivo enorme (6.657 líneas) pero el cambio se limita a la
cabecera del contenido y a un componente hijo de 83 líneas. No se toca ni el flujo de
fotos, ni el wizard manual, ni el análisis con IA, ni el CTA fijo.

**Qué NO se toca**: la lógica de `dataInputMode`, el wizard manual, el resultado del
análisis (el usuario ya rechazó en una ronda anterior que los resultados analizados se
plieguen: no se reintroduce), y el contenido por servicio.

**Cómo se verifica**: `/reservar` en 375×667 y 390×844, con un servicio de fotos y otro
manual-only (desbroce); medir con JS la altura hasta el primer elemento accionable de la
tarea antes y después; comprobar que cambiar entre fotos y manual sigue funcionando y que
no se pierde nada de lo ya introducido.

---

## Fase 12 — Paso 4: que elegir un día no repinte la pantalla entera

**Cierra**: fallo 2 (la parte gruesa), hallazgo H-06.

**Entregables**:
1. `ProvidersPage.tsx:636-681`: eliminar el `return` temprano que sustituye la página
   completa por un esqueleto. La cabecera, la barra de progreso y el bloque de calendario
   **permanecen montados** durante la recarga.
2. El esqueleto de tarjetas pasa a ocupar únicamente el hueco de la lista de jardineros
   (que es lo único que realmente se está recargando), manteniendo el resto de la pantalla
   estable. Se conserva `aria-busy`/`aria-live` que ya existe (`:657`) para que un lector
   de pantalla siga anunciando la carga.
3. Distinguir **primera carga** (pantalla vacía: esqueleto completo de la lista, como hoy)
   de **recarga con contenido ya en pantalla** (la lista anterior se mantiene visible,
   atenuada y no interactiva, mientras llega la nueva). Es el patrón que evita el parpadeo
   sin mentir al usuario sobre lo que está viendo.
4. Ajustar los esqueletos que hoy no coinciden con el contenido real y provocan saltos:
   42 círculos de calendario (`:966`) frente a ~35 celdas reales, y chips de horas de
   40 px de alto (`:1007`) frente al texto de "No hay horas válidas" de ~20 px (`:1010`),
   que hace saltar el bloque. Reservar altura estable en ambos.

**Riesgo**: medio. Se reestructura el render de una página de 1.100 líneas, pero **sin
tocar ningún `useEffect`, ninguna dependencia ni ninguna petición**: las mismas llamadas,
en el mismo momento, con los mismos datos. Solo cambia qué se pinta mientras tanto.

**Cómo se verifica**: con Supabase local arrancado, recorrer el paso 4 y tocar varios días
seguidos comprobando que el calendario **no desaparece** en ningún momento; confirmar en
`read_network_requests` que se siguen disparando exactamente las mismas peticiones que
antes del cambio (mismo número y mismo momento), y que la lista se actualiza al llegar.

---

## Fase 13 — Paso 4: carreras y parpadeos del bloque de horas

**Cierra**: hallazgos H-07, H-08, H-09.

**Entregables**:
1. `ProvidersPage.tsx:283`: quitar el `setHoursLoading(false)` de `rebuildMonth`. Ese
   indicador pertenece a `loadValidHours`, que es quien lo enciende y quien debe apagarlo.
   Es lo que hoy provoca el falso "No hay horas válidas en este día" (H-07).
2. `loadValidHours` (`:313-333`): añadir la misma guarda de identificador de petición que
   ya usa `rebuildMonth` (`reqIdRef`), para que una respuesta antigua no pise a la del día
   que el cliente está mirando (H-08). Se reutiliza el patrón que ya existe en el archivo,
   no se inventa uno nuevo.
3. Eliminar el estado muerto `hoursAvailable` (`:69`, `:340`, `:565-567`): se escribe en
   tres sitios, nunca se lee, y cada escritura repinta el componente entero (H-09).
4. Mientras se recargan las horas de un día nuevo, mantener visible el rango ya elegido en
   vez de vaciarlo de golpe, para que el bloque no colapse y vuelva a crecer.

**Riesgo**: medio. Es la única fase de esta tanda que toca efectos y flujo de carga. No
cambia qué se pide ni qué se calcula, pero sí **cuál de dos respuestas concurrentes gana**
(siempre la más reciente, que es la intención original del patrón ya presente en el
archivo). Requiere verificación en vivo, no vale solo con typecheck.

**Cómo se verifica**: tocar varios días seguidos muy rápido y comprobar que las horas que
quedan en pantalla son las del último día pulsado; que no aparece en ningún momento el
mensaje "No hay horas válidas" en un día que sí tiene horas; y que al elegir hora y
continuar, la reserva conserva exactamente la franja elegida (comprobando el
`quote_snapshot` persistido, que es donde vive el dato que de verdad importa).

---

## Resumen (las 13 fases)

| Fase | Cierra | Riesgo | Depende de |
|---|---|---|---|
| 1 — Logo oficial + componente reutilizable | Puntos 1, 3, H-02 | Bajo | — |
| 2 — Scroll al cambiar de página | Punto 9 | Bajo | — |
| 3 — Auth a ancho completo | Punto 2 (tanda 1) | Bajo | — |
| 4 — Cabecera: Reservar + quitar Acceder duplicado | Puntos 4, 5 | Medio | Fase 1 |
| 5 — Home: tarjeta principal más clara | Punto 6 | Bajo | — |
| 6 — Home: "Encuentra jardineros en tu zona" | Punto 7 | Bajo | — |
| 7 — Home: CTA final "¿Eres jardinero?" | Punto 8 | Bajo | — |
| 8 — Quitar Costa del Sol de Home y footer compartido | Punto 2 (tanda 2, Home) | Medio | — |
| 9 — Jardineros: mensaje, beneficios reales y SEO | Puntos 1.1, 1.2 | Bajo | — |
| 10 — Página "Costa del Sol" + patrón por ciudad | Punto 2 (tanda 2, página nueva) | Medio | Fase 8 (usa `showCoverageZones`) |
| 11 — Paso 3: primer pliegue legible en móvil | Fallo 1 (tanda 3) | Bajo-medio | — |
| 12 — Paso 4: sin repintado de pantalla completa | Fallo 2 (tanda 3), H-06 | Medio | — |
| 13 — Paso 4: carreras y parpadeos de horas | H-07, H-08, H-09 | Medio | Fase 12 (misma zona del archivo) |

## Manual — acciones del usuario

- Ninguna de las 10 fases toca Supabase, migraciones ni variables de entorno — el
  desplegable es el build de frontend habitual.
- Pendiente, fuera de este plan (ver `HALLAZGOS-NUEVOS.md`): subir
  `home/coverage/costa-del-sol.webp` al bucket `marketing-assets` (H-03) — nota: tras la
  Fase 8 esa foto solo se usará ya en `/marbella` y `/costa-del-sol`, no en la Home.
- Nueva, de la Fase 10: subir el hero y el `og:image` de la página Costa del Sol al
  bucket `marketing-assets` (rutas exactas en `marketingImageSlots` una vez implementada
  la fase) — mismo patrón que el resto de imágenes de marketing, cae a un degradado de
  marca limpio si no se sube.
