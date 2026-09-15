# Sistema de diseño — GarSer (mobile-first)

Este documento fija el estándar visual y de interacción de la web para que cualquier
pantalla nueva, o cualquier corrección futura, sea coherente con el resto de la app sin
tener que redescubrir el patrón cada vez. Se basa en componentes que **ya existen y
funcionan** en producción — no inventa un sistema nuevo desde cero, lo formaliza.

Origen: auditoría UX móvil 2026-09-14 (uso real como jardinero en garser.es vía PWA en
iOS Safari). Ver [`docs/audit/2026-09-14-ux-movil-jardinero/PLAN-IMPLEMENTACION.md`](audit/2026-09-14-ux-movil-jardinero/PLAN-IMPLEMENTACION.md).

---

## 1. Principios

- **Mobile-first**: se diseña primero para 320-430px de ancho (iPhone SE → iPhone Pro
  Max) y se expande con `sm:`/`md:`/`lg:` de Tailwind, nunca al revés.
- **Un único patrón por función**: un solo tipo de header, un solo tipo de diálogo de
  confirmación, un solo hook de guardado por patrón (auto o manual). Si hace falta un
  patrón nuevo, se añade aquí antes de usarse en una pantalla.
- **Reutilizar antes que duplicar**: antes de escribir un modal, un botón o un header
  nuevo, comprobar si ya existe en `src/components/common/`.

## 2. Breakpoints

Los de Tailwind 3 por defecto (`tailwind.config.js` no los sobreescribe):

| Prefijo | Ancho mínimo |
|---|---|
| (base, sin prefijo) | 0px — éste es el diseño principal |
| `sm:` | 640px |
| `md:` | 768px |
| `lg:` | 1024px |
| `xl:` | 1280px |

## 3. Color

### 3.1 Paleta funcional (UI, ya en uso en toda la app)

No hay tokens custom en `tailwind.config.js`; se usa la paleta por defecto de Tailwind:

| Uso | Clases |
|---|---|
| Acción primaria / CTA | `bg-gradient-to-r from-green-600 to-emerald-600`, texto blanco |
| Acción secundaria / neutra | `bg-white border border-gray-200 text-gray-700` |
| Acción destructiva | `text-red-600 border-red-200` (outline) o `bg-red-600` (sólido, solo para confirmar un "danger") |
| Aviso / advertencia | `amber-600` (fondo `bg-yellow-100` / icono `text-yellow-600` en el icono circular de los diálogos) |
| Texto principal | `text-gray-900` (títulos), `text-gray-600`/`text-gray-500` (cuerpo) |

### 3.2 Colores de marca (icono / PWA)

Muestreados del logo oficial, usados en el icono de instalación y en `theme_color` del
manifest (ver Fase 2 del plan):

- Navy `#161C2A`
- Verde `#23A54B`
- Verde claro `#3EC758`

Nota: son ligeramente distintos del `green-600`/`emerald-600` de Tailwind que usa el
resto de la interfaz. Es una discrepancia menor conocida, no cubierta por esta ronda de
correcciones — no homogeneizar sin que se pida explícitamente, para no tocar cientos de
botones ya en producción.

## 4. Iconografía

- Librería: `lucide-react`. Tamaño estándar `w-5 h-5` en botones, `w-4 h-4` en badges o
  texto inline, `w-6 h-6`/`w-8 h-8` en iconos destacados dentro de círculos de aviso.
- Icono de marca (instalación / favicon / apple-touch-icon): kit generado en
  `garser-iconos/` (fuera del repo, en Descargas), variante `C-claro`. Ver Fase 2 del
  plan para el detalle de integración.

## 5. Header estándar (`AppHeader`)

**Componente**: `src/components/common/AppHeader.tsx` (se crea en la Fase 1 del plan).

Todas las pantallas internas con navegación propia (Mis Reservas, Mis Chats, Mi Cuenta,
Gestión de Disponibilidad, y cualquier pantalla futura similar) usan este mismo header,
para que la web se sienta unida:

```
┌─────────────────────────────────────────────┐
│ [←/✕ Volver]      Título de la página   [⋮] │  ← sticky top-0 z-40
├─────────────────────────────────────────────┤
│ (opcional) selector de subpágina / filtro     │
├─────────────────────────────────────────────┤
│ (opcional) botón Guardar cambios, ancho total │
└─────────────────────────────────────────────┘
```

Reglas:

- `sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-gray-200`, con
  `padding-top: env(safe-area-inset-top)` para no invadir el notch/isla dinámica en PWA
  standalone. Es el mismo patrón que ya usa `src/components/public/PublicHeader.tsx:7`
  — se generaliza, no se inventa.
- **Botón volver/salir**: icono `ArrowLeft` o `X` (lucide) + texto opcional en `sm:`.
  Si hay cambios sin guardar pendientes en la pantalla, el botón vuelve a través de
  `useConfirmDialog` (ver §7) en vez de navegar directo.
- **Título**: `text-lg font-bold text-gray-900`, centrado o a la izquierda del botón,
  una sola línea con `truncate` si hace falta.
- **Slot derecho opcional**: selector de subpágina (segmented control, ver §6) o botón
  de guardado (ver §6), nunca los dos apilados sin jerarquía clara — el selector va
  primero, el guardado debajo si ambos coexisten (caso Disponibilidad).
- El header **nunca** se sustituye por un botón flotante pegado al pie de página — ese
  patrón (visto hoy en `AvailabilityManager.tsx:655-668`) se retira porque se solapa con
  el menú rápido inferior de la web en móvil.

## 6. Botones

Patrón ya consistente en `UnsavedChangesModal.tsx`, `ConfirmDialog.tsx` y
`AvailabilityManager.tsx` — se formaliza para reutilizar tal cual:

| Tipo | Clases base |
|---|---|
| Primario (guardar, confirmar) | `w-full bg-green-600 text-white py-3 px-4 rounded-xl font-bold shadow-lg shadow-green-600/20 hover:bg-green-700 active:scale-[0.98] transition-all` |
| Primario deshabilitado (sin cambios que guardar) | añadir `disabled:opacity-50 disabled:cursor-not-allowed` — el botón de guardar de un formulario **siempre** nace deshabilitado y se activa solo cuando hay cambios reales, igual que ya hace `AvailabilityManager.tsx:454` |
| Secundario / cancelar | `w-full bg-white text-gray-700 border border-gray-200 py-3 px-4 rounded-xl font-bold hover:bg-gray-50` |
| Destructivo (descartar, eliminar) | `w-full bg-white text-red-600 border border-red-200 py-3 px-4 rounded-xl font-bold hover:bg-red-50` |
| Selector de subpágina (segmented control) | patrón ya usado en `AvailabilityManager.tsx:366-403` para "Ajustes puntuales / Horario fijo" — pestañas con fondo `bg-gray-100 rounded-xl p-1` y la activa en `bg-white shadow-sm` |

## 7. Avisos y diálogos de confirmación

**Componente canónico**: `src/components/common/ConfirmDialog.tsx`, hook
`useConfirmDialog()`. Es el único diálogo de confirmación que debe usarse en pantallas
nuevas o corregidas — **no crear modales de confirmación inline con `createPortal`
copiados a mano** (ese es exactamente el problema que tiene hoy
`AvailabilityManager.tsx:611-646`, que duplica el markup de `ConfirmDialog` en vez de
usarlo, y que la Fase 5 del plan corrige).

Tonos disponibles (`ConfirmTone`): `danger`, `warning`, `phytosanitary_warning`. Reglas:

- El icono siempre es `AlertTriangle` dentro de un círculo (`bg-red-100`/`bg-yellow-100`
  según tono).
- **La opción seguraa recibe el foco automático** al abrir el diálogo (nunca la
  destructiva), y `Escape` cierra el diálogo salvo que haya una acción en curso.
- Para "salir sin guardar" con 3 opciones (guardar y salir / descartar / seguir editando)
  se usa el patrón ya existente en `src/components/common/UnsavedChangesModal.tsx`
  (mismo estilo visual, pero con 3 botones en vez de 2) — se mantiene como componente
  aparte porque su forma (3 acciones) no encaja en `useConfirmDialog` (2 acciones), no
  se fuerza a converger los dos componentes en esta ronda.

## 8. Formularios e inputs

**Regla de oro, sin excepciones**: ningún `<input>`, `<select>` ni `<textarea>` puede
tener una clase de tamaño de fuente inferior a `text-base` (16px). Por debajo de eso,
iOS Safari hace auto-zoom al enfocar el campo — es un problema de accesibilidad/UX, no
estético. Si se necesita un input visualmente compacto, se reduce el `padding`, nunca el
`font-size` por debajo de 16px.

- Punto único de control para los 7 configuradores de precios:
  `src/components/gardener/UnifiedNumericInput.tsx`.
- Ejemplo ya correcto a imitar: `PhytosanitaryPricingConfigurator.tsx:698`, que usa
  `text-base sm:text-sm` (16px en móvil, compacto en escritorio).

## 9. Contenedores y anchura

- Padding lateral mínimo en móvil: `px-4`. No usar paddings menores (`px-2.5`, visto hoy
  en `ProfileSettings.tsx:741`) salvo justificación explícita de espacio.
- `max-w-*` se aplica solo a partir de `sm:`/`md:` — en el breakpoint base el contenido
  ocupa el 100% del ancho disponible.
- Grids de formulario: `grid-cols-1` en móvil siempre, `md:grid-cols-2` o superior a
  partir de tablet — nunca dos columnas por debajo de `md:`.
- Ningún elemento hijo puede fijar un ancho absoluto (`w-[Nrem]`) mayor que el que su
  contenedor padre puede garantizarle en una pantalla de 320px; si necesita un mínimo,
  usar `max-w-` sobre `w-full`, no `w-` fijo (ver Fase 4 del plan, caso desbroce).

## 10. Guardado de formularios: dos patrones válidos, no mezclar

1. **Autosave** (`src/hooks/useAutoSave.ts` + `src/components/common/SaveStatusIndicator.tsx`):
   guarda solo tras una pausa de escritura, muestra "Guardando…/Guardado" de forma
   discreta. Válido para campos sueltos de edición rápida (perfil personal, cobertura).
2. **Guardado manual con header** (nuevo, Fase 5-6 del plan / cambios lógicos
   pendientes para los configuradores de precio): header con nombre de la sección, botón
   salir y botón "Guardar cambios" que solo se activa si hay cambios, más diálogo de
   "salir sin guardar" (§7) si se intenta salir con cambios pendientes. Válido para
   configuraciones largas donde un mensaje de "Guardado" en cada tecleo es ruidoso.

No mezclar los dos patrones dentro de la misma pantalla.
