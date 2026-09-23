# Hallazgos nuevos detectados durante la corrección (2026-09-19)

No forman parte de los 9 puntos reportados por el usuario. Se documentan aquí porque
aparecieron investigando la causa raíz de esos puntos, y no se corrigen en el plan de
implementación de esta ronda salvo que se indique lo contrario.

---

## H-01 — El patrón de CTA verde documentado en `design-system.md` no cumple contraste WCAG AA — ✅ CORREGIDO 2026-09-23

- **Severidad**: Media-alta (accesibilidad)
- **Evidencia**: `docs/design-system.md` documenta dos patrones distintos de botón
  primario en verde:
  - §3.1: `bg-gradient-to-r from-green-600 to-emerald-600`, texto blanco — usado en
    `CustomerExperienceSections.tsx:54,199` ("Empezar nueva reserva"), en
    `AuthForm.tsx:576` (botón de envío) y en `GardenersLandingPage.tsx:104,193`.
  - §6: `bg-green-600` plano, texto blanco — el "primario" de `ConfirmDialog.tsx`,
    `UnsavedChangesModal.tsx` y `AvailabilityManager.tsx` (pantallas internas).

  Calculado el contraste real de texto blanco sobre cada color (fórmula WCAG 2.x,
  luminancia relativa sRGB):
  - `green-600` (`#16A34A`): **3.30:1**
  - `emerald-600` (`#059669`): **3.77:1** (coincide con el 3.76:1 que ya medía
    Lighthouse/axe en producción)

  El mínimo exigido por WCAG AA para texto normal es **4.5:1**. Ambos colores —y por
  tanto el degradado que combina los dos— quedan por debajo, en toda la web pública Y
  en las pantallas internas del jardinero.
- **Qué pasa**: el botón de acción primaria de toda la app (el de más peso en
  conversión) no es legible con la garantía mínima de contraste para usuarios con baja
  visión.
- **Por qué no se corrige en esta ronda**: el propio `design-system.md` (§3.2) advierte
  explícitamente "no homogeneizar sin que se pida explícitamente, para no tocar
  cientos de botones ya en producción" — arreglarlo bien implica decidir un verde
  accesible único y aplicarlo a botones ya desplegados en decenas de pantallas, dentro
  y fuera de esta ronda de UX público/móvil.
- **Qué se hizo en su lugar**: para el único botón **nuevo** de esta ronda (el
  "Reservar" de `PublicHeader.tsx`, fase 4), se usa `emerald-700` (contraste 5.5:1,
  pasa AA) en vez de replicar el patrón que falla — ver nota en esa fase del plan. No
  se ha tocado ningún botón ya existente.
- **Sugerencia para una ronda aparte**: decidir un verde de acción primaria que cumpla
  4.5:1 (candidatos: `emerald-700` 5.5:1, `green-700` 5.0:1) y actualizar
  `design-system.md` + una pasada de reemplazo consciente, con su propia verificación
  de accesibilidad.
- **Corrección aplicada (2026-09-23)**: unificado a `bg-emerald-700`
  (`hover:bg-emerald-800`), contraste 5.5:1. Se sustituyeron con precisión de línea
  (no con un `sed` global de archivo, para no tocar lo que no correspondía) las **93
  líneas** en **50 archivos** donde `bg-green-600`/`bg-emerald-600`/el degradado
  coincidían con `text-white` en la misma línea — es decir, botones reales, no barras de
  progreso, *toggles* ni insignias (esas 11 líneas, identificadas y revisadas una a una,
  se dejaron intactas a propósito). Incluye `ConfirmDialog.tsx`, `UnsavedChangesModal.tsx`
  y `AvailabilityManager.tsx` (los tres que documentaba el §6 de `design-system.md`),
  `AuthForm.tsx`, todo el funnel de reserva y las landings públicas. `design-system.md`
  §3.1 y §6 actualizados al nuevo estándar único. Verificado: `npx tsc --noEmit` limpio,
  batería completa (`npx vitest run`) — **68 archivos / 462 tests** en verde, y
  comprobado en vivo (color computado `rgb(4, 120, 87)` = `emerald-700`) en el CTA de la
  Home y en el botón de envío de `/auth` (que antes era el degradado).

---

## H-02 — El logo roto (`/garser-logo.svg`) también afecta al header del jardinero, no solo a `/auth`

- **Severidad**: Baja (el fallback de texto ya es limpio, pero el diseño previsto no se ve nunca)
- **Evidencia**: `src/components/layout/Navbar.tsx:132` usa `<img src="/garser-logo.svg" ...>` con el mismo `onError` que `AuthForm.tsx:357`. El archivo **nunca ha existido** en `public/` (confirmado con `git log --follow`, sin resultados). Afecta al header del jardinero, del cliente logueado y del admin — no solo a la pantalla de login que reportó el usuario.
- **Se corrige en esta ronda**: sí — Fase 1 del plan sustituye ambas referencias (y añade una tercera en `PublicHeader.tsx`, que hoy no usa ninguna imagen) por el logo oficial, a través de un componente compartido nuevo (`GarserLogo`) para no triplicar la lógica de fallback.

---

## H-03 — La imagen de "cobertura Costa del Sol" está rota en producción (contenido, no código)

- **Severidad**: Media
- **Evidencia**: slot `home.coverage` → `home/coverage/costa-del-sol.webp`
  (`src/config/publicSiteContent.ts`). El objeto no existe en el bucket
  `marketing-assets` de Supabase Storage en producción (verificable con una petición
  directa a esa URL — no se ha vuelto a comprobar hoy en vivo, se deja como hallazgo a
  confirmar). El componente que la sirve (`MarketingImageSlot.tsx`) ya cae de forma
  limpia a un degradado de marca si falla, así que no rompe el layout.
- **Por qué no se corrige en esta ronda**: es un archivo que falta subir a Supabase
  Storage, no un bug de código — fuera del alcance de una corrección de diseño.
- **Acción manual pendiente**: subir `home/coverage/costa-del-sol.webp` al bucket
  `marketing-assets`. Relevante porque la Fase 6 de este plan reescribe el texto de esa
  misma sección ("Encuentra jardineros en tu zona") — el texto quedará correcto pero la
  foto seguirá sin verse hasta que se suba el archivo.

---

## H-04 — Código muerto: wizard fantasma de alta de jardinero en `AuthForm.tsx` (hallazgo lógico, no de diseño) — ✅ CORREGIDO 2026-09-23

- **Severidad**: — (no es un fallo visible; es deuda técnica)
- **Evidencia**: `AuthForm.tsx` declara un wizard completo de 7 pasos para el alta de
  jardinero (estado `step`, datos personales, recorte circular de foto, selección de
  `SERVICES`/`TOOLS`, experiencia, certificaciones — ~150 líneas) y construye con todo
  ello un `applicationPayload` al enviar. **Ninguno de esos campos se renderiza en el
  JSX** (no hay ningún `step === N` condicional) — seleccionar "Jardinero" muestra el
  mismo formulario de 3 campos que "Cliente". Y aunque se rellenaran, `AuthContext.signUp`
  ignora ese parámetro intencionadamente (el alta real ocurre después, en `/apply` vía
  `GardenerApplicationWizard`).
- **Por qué no es un bug activo**: el flujo real funciona (registro simple → confirmar
  email → login → `/apply`), y no se pierde ningún dato porque nunca se llega a enviar.
- **Por qué merece una ronda aparte**: son ~150 líneas de estado y handlers de recorte
  de imagen cargados en el bundle de la página pública más sensible al peso (`/auth`),
  sin ningún efecto, que pueden confundir a quien lea el archivo pensando que ese
  wizard está activo.
- **No se toca en este plan** — es lógica/limpieza de código, no diseño (ver Fase 0 de
  esta skill). Queda anotado para cuando el usuario decida abordarlo.
- **Corrección aplicada (2026-09-23)**: eliminadas las ~150 líneas muertas — estado del
  wizard de 7 pasos, recorte circular de foto, `SERVICES`/`TOOLS`, `isStepValid`, y la
  construcción de `applicationPayload` en `onSubmit`, que ahora llama a
  `signUp(email, password, role)` igual para las dos vías (antes ya era así para
  "Cliente"; "Jardinero" tenía la rama muerta). También se retiraron dos imports de
  `lucide-react` (`UploadCloud`, `Plus`) que solo usaba ese wizard, y un `useEffect`
  vacío que no hacía nada. El archivo pasa de 676 a 505 líneas.
  Verificado: `npx tsc --noEmit` limpio con `noUnusedLocals`/`noUnusedParameters`
  activados (confirma que no queda ningún import o variable huérfana); probado en vivo
  el registro real de cliente y de jardinero — el `POST .../auth/v1/signup` llega a
  Supabase con 200 OK en ambos casos, idéntico antes y después del cambio.

---

## H-10 — El modal de "confirma tu email" no llega a mostrarse tras registrarse (preexistente, no introducido por H-04)

- **Severidad**: Media (afecta a la señal de éxito del registro, no al registro en sí)
- **Evidencia**: al completar el registro (cliente o jardinero, probado en local con
  Supabase local), `AuthContext.signUp` (`AuthContext.tsx:203-220`) crea la cuenta,
  **inicia sesión momentáneamente** (evento `SIGNED_IN` en consola) y a propósito
  cierra esa sesión (`supabase.auth.signOut()`, línea 214) porque el alta real espera a
  la verificación de email. Ese ciclo `SIGNED_IN` → `Signed out` remonta `AuthForm`
  antes de que termine de ejecutarse `setShowEmailModal(true)`: el formulario vuelve a
  su estado inicial (releído de la URL) y el modal de "revisa tu correo" nunca se pinta.
  Reproducido igual en la vía de **cliente**, que H-04 no ha tocado — confirma que no es
  una regresión de esta corrección.
- **Qué pasa**: el cliente/jardinero completa el registro con éxito (la cuenta se crea
  de verdad) pero no recibe ninguna confirmación visual de que debe revisar su correo —
  ve el formulario en blanco otra vez, como si no hubiera pasado nada.
- **Por qué no se corrige aquí**: es un bug de comportamiento (ciclo de sesión que
  remonta el componente), no de diseño visual — cae fuera del alcance de esta skill (ver
  Fase 0). El comentario ya existente en `AuthContext.tsx:204` ("Eliminamos
  `setLoading(true)` para no desmontar `AuthForm` durante el proceso") muestra que ya
  hubo un intento previo de evitar justo este problema, insuficiente porque el remontaje
  no lo causa `loading` sino el propio ciclo de sesión.
- **Nota de entorno**: no descartado que en producción, con verificación de email real
  (sin autoconfirmación local), el ciclo `SIGNED_IN`/`Signed out` sea más lento y deje
  ver el modal antes de resolverse — pendiente de confirmar en producción real antes de
  priorizar el arreglo.

---

## H-05 — El footer público tiene la misma ancla rota que ya se corrigió en la cabecera

- **Severidad**: Media (detectado 2026-09-19, segunda tanda)
- **Evidencia**: `src/components/public/PublicFooter.tsx:39` — `<a
  href="#reserva">Empezar reserva</a>`. Es el mismo patrón que `PublicHeader.tsx` tenía
  antes de la Fase 4 de este plan: el `id="reserva"` solo existe en
  `CustomerExperienceSections.tsx` (Home/Marbella), así que en `/para-jardineros` el
  enlace no hace nada. No se corrigió en la Fase 4 porque esa fase solo tocó
  `PublicHeader.tsx`.
- **Se corrige en esta ronda**: sí — Fase 8 lo sustituye por el mismo botón funcional ya
  estandarizado en la Fase 4 (limpia el borrador y navega a `/reservar?start=1`).

---

# Hallazgos del funnel de reserva (2026-09-20, tercera tanda)

Encontrados analizando los dos fallos reportados en el formulario de reserva. Los cuatro
son de mecánica de render, no de reglas de negocio: ninguno cambia qué datos se piden ni
qué precios se calculan.

## H-06 — Elegir un día en el calendario desmonta y repinta la página entera

- **Severidad**: Alta (es la causa principal del "va a tirones")
- **Evidencia**: `ProvidersPage.tsx:636` hace `if (loading) return (<esqueleto de página completa>)`. Ese
  `loading` lo activa el efecto de carga de jardineros (`:378`), que tiene `selectedDate`
  entre sus dependencias (`:560`). Resultado: cada vez que el cliente toca un día del
  calendario, React desmonta la cabecera, la barra de progreso, la lista de jardineros
  **y el propio calendario**, y los sustituye por un esqueleto de página completa.
- **Qué ve el cliente**: el calendario desaparece literalmente bajo su dedo justo después
  de tocarlo, y vuelve a aparecer un instante después. Es el salto más brusco de todo el
  funnel.
- **Matiz importante**: refrescar los jardineros al cambiar de día **es correcto** — el
  precio y la disponibilidad de cada profesional dependen de la fecha. El fallo no es que
  se pida el dato, es que se repinta toda la pantalla en vez de solo la lista.
- **Se corrige**: Fase 12.

## H-07 — Un cargador apaga el indicador de otro, y aparece un falso "No hay horas válidas"

- **Severidad**: Media
- **Evidencia**: `ProvidersPage.tsx:283` — `rebuildMonth` (que carga los días del mes)
  hace `setHoursLoading(false)`, apagando el indicador de carga de las **horas**, que no
  le pertenece y que `loadValidHours` (`:314`) acaba de encender. Con la petición de horas
  todavía en vuelo, `validHours` sigue vacío, así que se cumple la rama `:1009` y se pinta
  "No hay horas válidas en este día."
- **Qué ve el cliente**: un mensaje de "no hay horas" que desaparece solo un momento
  después y se convierte en horas disponibles. Parece un error del sistema.
- **Se corrige**: Fase 13.

## H-08 — La carga de horas no tiene guarda de carrera

- **Severidad**: Media
- **Evidencia**: `rebuildMonth` sí protege su respuesta con un identificador de petición
  (`reqIdRef`, `:284`/`:292`/`:309`), pero `loadValidHours` (`:313-333`) no lo hace. Si el
  cliente toca varios días seguidos, la respuesta de un día anterior puede llegar después
  y sobrescribir las horas del día que está mirando.
- **Qué ve el cliente**: horas que no corresponden al día seleccionado, o un parpadeo
  entre dos juegos de horas.
- **Se corrige**: Fase 13.

## H-09 — Estado muerto que provoca repintados de más

- **Severidad**: Baja
- **Evidencia**: `ProvidersPage.tsx:69` — `const [, setHoursAvailable] = useState<number[]>([]);`.
  El valor se descarta en la propia desestructuración, así que **nunca se lee**; solo se
  escribe, en `:340`, `:566` y a través del efecto `:565-567`, cuyo único cometido es
  llamar a ese setter. Cada escritura provoca un repintado completo de un componente de
  1.100 líneas sin que cambie nada en pantalla.
- **Se corrige**: Fase 13.
