# Plan de implementación — Fallos UX móvil (jardinero, PWA)

**Origen**: prueba de usuario real en garser.es desde iPhone (Safari, añadido a
pantalla de inicio) el 2026-09-14, rol jardinero. 19 fallos detectados por el usuario.

**Alcance**: solo diseño/UX. Los fallos marcados por el usuario como **CAMBIO LÓGICO**
(9, 10, 18) quedan fuera de este plan y se documentan en
[`CAMBIOS-LOGICOS-PENDIENTES.md`](CAMBIOS-LOGICOS-PENDIENTES.md) para atacarlos después.

**Estado del repo en el momento del análisis**: `main` sincronizado con
`origin/main` (`33e9110`, incluye el cierre de la auditoría transversal turno 2).

**Estándar a seguir**: [`docs/design-system.md`](../../design-system.md) — headers,
botones, diálogos e inputs de todas las fases siguen ese documento para que el
resultado sea coherente entre sí y con el resto de la web.

---

## Resumen de causas raíz

Antes de las fases, tres hallazgos explican varios fallos a la vez:

- **No existe ningún manifest ni meta-tag PWA** (`index.html` no referencia manifest,
  no tiene `apple-touch-icon`, no tiene `apple-mobile-web-app-capable`). El único
  "icono" es `public/favicon.svg`, que iOS no usa como icono de pantalla de inicio (por
  eso aparece la "G" genérica). Esto explica a la vez los **fallos 1, 3 y 4**: sin esas
  etiquetas, "Añadir a inicio" solo crea un marcador de Safari a la URL que estuviera
  abierta en ese momento (probablemente `/auth`), en vez de instalar una app que
  arranque siempre en `/`.
- **La sesión de Supabase ya persiste correctamente** (`persistSession: true` +
  `localStorage`, `src/lib/supabase.ts:52-59`). La causa de que se pierda (**fallo 2**)
  no es la falta de un "recordarme", sino que Safari limita a 7 días el almacenamiento
  de sitios abiertos como marcador normal (ITP). Una PWA instalada de verdad con las
  etiquetas de la Fase 2 queda exenta de ese límite.
- **La ruta raíz `/` ya hace lo correcto** (`src/App.tsx:285-296`): si hay sesión,
  redirige a `/dashboard`; si no, muestra la portada pública. No hace falta tocar
  lógica de rutas — arreglar el manifest/iconos es suficiente para que el icono de
  inicio abra siempre por `/` y deje que esta lógica ya existente decida.
- **El icono de instalación ya está resuelto**: hay un kit generado en
  `/Users/javier/Downloads/garser-iconos/C-claro/web/` (favicon.ico, apple-touch-icon
  180×180, icon-192/512, maskable-512, `site.webmanifest`, `head-snippet.html`) listo
  para copiar. No hace falta generar ni diseñar nada nuevo.

---

## Fase 1 — Fundamentos de diseño compartidos

Sin esto, cada header/pantalla posterior saldría ligeramente distinto. Se construye una
vez y se reutiliza en las fases 3, 5 y 6.

**Entregables**:
1. `src/components/common/AppHeader.tsx` — header sticky reutilizable (botón
   volver/salir + título + slot derecho opcional), según la especificación de
   `docs/design-system.md` §5.
2. **Fallo 11** — `src/components/gardener/UnifiedNumericInput.tsx:99`: `text-sm` →
   `text-base`. Corrige el auto-zoom de iOS en los inputs numéricos de los 7
   configuradores de precio de una sola vez (todos lo importan).
3. **Fallo 7** — `src/components/gardener/PhytosanitaryLicenseUpload.tsx:274`:
   `text-sm` → `text-base` en el campo de número de licencia.

**Riesgo**: bajo. Un componente nuevo sin usar todavía + dos cambios de una clase CSS
cada uno. No toca lógica, rutas, ni Supabase.

**Fallos cerrados**: 7, 11.

---

## Fase 2 — PWA instalable: icono, manifest, sesión, arranque

**Entregables**:
1. Copiar el kit ya generado a `public/`:
   - `garser-iconos/C-claro/web/*.png` → `public/icons/`
   - `garser-iconos/C-claro/web/favicon.ico` → `public/favicon.ico`
   - `garser-iconos/C-claro/web/site.webmanifest` → `public/site.webmanifest`
     (ajustando `description` si se quiere afinar el texto).
2. `index.html`: incorporar el contenido de `head-snippet.html` (enlaces a favicon,
   apple-touch-icon, manifest, `theme-color`) y añadir las etiquetas que el snippet no
   trae pero hacen falta para el modo standalone real:
   - `<meta name="apple-mobile-web-app-capable" content="yes">`
   - `<meta name="apple-mobile-web-app-status-bar-style" content="default">`
   - `<meta name="apple-mobile-web-app-title" content="GarSer">`
   - `<meta name="mobile-web-app-capable" content="yes">` (equivalente Android)
3. Construir `src/components/common/InstallAppPrompt.tsx`: detecta la plataforma
   (`navigator.standalone` / `matchMedia('(display-mode: standalone)')` para saber si
   ya está instalada; `userAgent` para diferenciar iOS/Android) y muestra instrucciones
   adaptadas:
   - **iOS Safari**: pasos ilustrados "Compartir → Añadir a pantalla de inicio" (no
     existe evento de instalación automática en iOS).
   - **Android Chrome**: escucha `beforeinstallprompt`, guarda el evento y muestra un
     botón "Instalar app" que lo dispara; si el navegador no soporta el evento, cae a
     instrucciones manuales equivalentes (menú → "Instalar app"/"Añadir a pantalla de
     inicio").
   - Si ya se detecta modo standalone, el componente no se muestra.
   - Este componente se construye aquí pero **se monta en la Fase 6**, dentro de "Mi
     Cuenta" (así el fallo 1 no obliga a decidir ya el copy/ubicación definitiva antes
     de tener el header de esa página).

**Riesgo**: bajo-medio. Son archivos estáticos + un componente nuevo aislado. Cero
cambios en `src/lib/supabase.ts`, `AuthContext.tsx` o `ProtectedRoute.tsx` — la
persistencia de sesión ya es correcta.

**Fallos cerrados**: 2, 3, 4 (el 1 se completa visualmente en la Fase 6).

---

## Fase 3 — Perfil del jardinero: pestañas reales + ancho de pantalla

**Entregables**:
1. **Fallo 5** — `src/components/gardener/ProfileSettings.tsx:89-90`: cambiar el valor
   por defecto de `activeTab` (hoy `'monolith'`, que concatena las 3 secciones en un
   único scroll) para que al entrar sin `?tab=` se muestre una sola sección (p. ej.
   `'personal'`), igual que si el usuario hubiera pulsado esa pestaña.
2. `src/components/gardener/profile-tabs/ProfileSidebar.tsx`: en móvil, mostrar las 3
   pestañas (Información personal / Cobertura y zonas / Servicios) como una franja
   horizontal tipo segmented control (mismo patrón que ya usa
   `AvailabilityManager.tsx:366-403` para sus subpáginas), en vez de una lista vertical
   apilada encima del contenido.
3. **Fallo 6** — auditar y corregir anchura en `PersonalTab.tsx`, `CoverageTab.tsx` y
   `ServicesTab.tsx`: eliminar paddings/`max-w` innecesarios (según la regla de
   `docs/design-system.md` §9) para que los campos usen el ancho completo disponible en
   pantallas de 320-430px.

**Riesgo**: bajo. Cambios de estado de UI (`activeTab`) y clases Tailwind. No toca el
guardado (`useAutoSave`) ni el modelo de datos del perfil.

**Fallos cerrados**: 5, 6.

---

## Fase 4 — Configuradores de precio: overflow horizontal y subida de archivo

**Entregables**:
1. **Fallo 12** — `src/components/gardener/WeedingPricingConfigurator.tsx:149-167`
   (`renderPercentageInput`): sustituir el `w-[6.5rem]` fijo del contenedor por
   `w-full max-w-[7.5rem]`, el mismo patrón que ya usa con seguridad la línea 345 del
   mismo archivo para el input de herbicida. Elimina el scroll horizontal de la
   sección "Suplementos y dificultad".
2. **Fallo 8** — `src/components/gardener/PhytosanitaryLicenseUpload.tsx:299`: quitar
   el atributo `capture="environment"` del `<input type="file">` (se mantiene
   `accept="image/jpeg,image/png,image/jpg,.pdf"` sin cambios), para que el selector
   nativo ofrezca elegir entre cámara y galería/Archivos en vez de forzar la cámara.

**Riesgo**: bajo. Dos cambios acotados a un contenedor CSS y un atributo HTML; la
validación de tipo/tamaño de archivo (`handleFileSelect`) no se toca.

**Fallos cerrados**: 8, 12.

*(Los fallos 9 y 10, que conviven en estos mismos archivos, quedan fuera de esta fase
por estar marcados como cambio lógico — ver el documento de pendientes.)*

---

## Fase 5 — Gestión de disponibilidad: instrucciones plegables + header estándar

Esta es la pantalla que el usuario cita como referencia de buen comportamiento
("aviso con botones de rechazar/aceptar igual que gestión de disponibilidad"), pero que
también tiene dos fallos propios que corregir.

**Entregables**:
1. **Fallo 13** — colapsar el bloque de "instrucciones de uso" de la subpágina
   "Horario fijo" en un acordeón: un título pulsable que despliega el contenido,
   colapsado por defecto.
2. **Fallo 14** — sustituir el botón "Guardar" flotante inferior
   (`AvailabilityManager.tsx:655-668`, que hoy se solapa con el menú rápido de la web)
   por el `AppHeader` de la Fase 1: botón para abandonar la página + selector de
   subpágina (Ajustes puntuales / Horario fijo) + botón "Guardar cambios" debajo,
   siempre visible arriba y nunca pegado al pie. Este mismo header con botón de
   guardado sustituye también al mecanismo de guardado actual de "Ajustes puntuales",
   unificando el comportamiento entre ambas subpáginas tal y como pide el fallo 14.
3. **Refactor de limpieza (mismo comportamiento, sin cambio lógico)**: sustituir el
   modal "¿deseas guardar los cambios?" duplicado e inline
   (`AvailabilityManager.tsx:611-646`, construido a mano con `createPortal`) por el
   hook reutilizable `useConfirmDialog()` de `ConfirmDialog.tsx`, que ya es el patrón
   canónico según `docs/design-system.md` §7. No cambia el texto ni el disparo del
   aviso, solo deja de duplicar el componente.

**Riesgo**: medio — es la pantalla con más JSX a reestructurar, pero ningún cambio
altera *cuándo* ni *qué* se guarda: `hasUnsavedChanges`, `saveWeeklyAvailability` y el
resto de la lógica de guardado no se tocan, solo se reubican los controles visuales.

**Fallos cerrados**: 13, 14.

---

## Fase 6 — Encabezados estándar restantes + instalación visible

Aplica el mismo `AppHeader` de la Fase 1 (ya probado en las Fases 3 y 5) a las cuatro
pantallas que quedan sin encabezado fijo, y cierra el fallo 1 montando el componente de
instalación construido en la Fase 2.

**Entregables**:
1. **Fallo 15** — `src/components/gardener/GardenerBookings.tsx`: añadir `AppHeader`
   con botón volver + título "Mis Reservas" + el selector de estado ya existente
   (`<select>` de `statusFilter`), reubicado dentro del header sin tocar sus opciones.
2. **Fallo 16** — `src/components/layout/Navbar.tsx:112`: añadir `sticky top-0 z-40`
   (mismo patrón que `PublicHeader.tsx:7`) para que el logo, el botón "Salir" y el menú
   hamburguesa dejen de hacer scroll con la página. Cambio de una línea de clases.
3. **Fallo 17** — `src/components/chat/ChatList.tsx`: añadir `AppHeader` con botón
   volver + título "Mis Chats". El botón "Reseñas" (líneas 194-209) se mantiene
   exactamente igual — su ocultación para jardineros es el fallo 18 (cambio lógico,
   fuera de esta fase).
4. **Fallo 19** — `src/components/account/MyAccount.tsx`: añadir `AppHeader` con
   título "Mi Cuenta" + botón salir, y montar aquí `InstallAppPrompt` (Fase 2), cerrando
   el fallo 1 por completo.

**Riesgo**: bajo. Mismo componente ya validado dos veces antes, aplicado 4 veces más.

**Fallos cerrados**: 1 (completado), 15, 16, 17, 19.

---

## Resumen

| Fase | Fallos que cierra | Riesgo |
|---|---|---|
| 1 — Fundamentos | 7, 11 | Bajo |
| 2 — PWA instalable | 2, 3, 4 (+ 1 parcial) | Bajo-medio |
| 3 — Perfil jardinero | 5, 6 | Bajo |
| 4 — Configuradores: overflow y archivo | 8, 12 | Bajo |
| 5 — Disponibilidad | 13, 14 | Medio |
| 6 — Headers restantes + instalación | 1, 15, 16, 17, 19 | Bajo |

15 de los 19 fallos quedan cerrados por este plan. Los 3 restantes (9, 10, 18) están en
[`CAMBIOS-LOGICOS-PENDIENTES.md`](CAMBIOS-LOGICOS-PENDIENTES.md).

## Manual — acciones del usuario

*(nada que desplegar todavía: este documento es solo el plan; cada fase, al
ejecutarse, añadirá aquí sus propias acciones manuales si las tuviera — p. ej. verificar
visualmente el icono instalado en un iPhone y un Android reales tras la Fase 2)*
