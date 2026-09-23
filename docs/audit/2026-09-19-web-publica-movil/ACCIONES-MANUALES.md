# Acciones manuales pendientes — tanda web pública/móvil (2026-09-19/20)

Acciones que **no puede hacer el código** y que quedan pendientes del usuario. Se
ejecutan al terminar todas las fases, antes o justo después del PR según cada caso.

Ninguna de las fases implementadas toca el esquema de Supabase, migraciones ni
variables de entorno: el desplegable de código es el build de frontend habitual.

---

## 1. Subir imágenes al bucket `marketing-assets` (Supabase Storage)

Todas las imágenes de marketing viven en Supabase Storage, no en el repo
(`MarketingImageSlot.tsx` + `marketingAssets.ts`). Si el archivo no existe, el
componente cae a un degradado de marca limpio con la etiqueta del path — no rompe el
layout, pero deja el hueco vacío.

| Prioridad | Archivo a subir | Dónde se ve | Especificación |
|---|---|---|---|
| **Alta** | `gardeners/hero.webp` | Primera foto de `/para-jardineros` | Vertical/cuadrada, contenedor `min-h-[320px]`. Es la primera impresión de la página cuyo único objetivo es captar jardineros — hoy se ve el degradado vacío |
| **Alta** | `costa-del-sol/hero.webp` | Página nueva `/costa-del-sol` (Fase 10) | Horizontal, foto de jardín residencial de la zona |
| **Media** | `shared/og/costa-del-sol.webp` | Vista previa al compartir `/costa-del-sol` | 1200×630 px (formato Open Graph) |
| **Media** | `home/coverage/costa-del-sol.webp` | Bloque de cobertura de `/marbella` y `/costa-del-sol` | Horizontal. Tras la Fase 8 ya **no** se usa en la Home |
| **Media** | `gardeners/process.webp` | Bloque "Cómo funciona" de `/para-jardineros` | Vertical/cuadrada |

> Nota (hallazgo H-03): estas imágenes devolvían HTTP 400 en producción porque el
> objeto no existe en el bucket. No es un bug de código.

## 2. Revisar el peso de las 7 fotos de servicios

Las fotos de `home/services/*.webp` que sí están subidas pesan entre 867 KB y 1,27 MB
cada una (algunas son JPEG con extensión `.webp`). Se muestran en la Home, en Marbella
y ahora también en `/costa-del-sol`. Conviene reexportarlas como WebP real de
≤150-200 KB: es el factor que más pesa en el tiempo de carga de las landings en móvil.

## 3. ~~Decisión pendiente: contraste del verde de marca~~ — corregido 2026-09-23 (hallazgo H-01)

El patrón de botón primario documentado en `docs/design-system.md` (§3.1 degradado
`from-green-600 to-emerald-600` y §6 `bg-green-600` plano) no cumplía el contraste
mínimo WCAG AA con texto blanco (3,30:1 y 3,77:1 frente al 4,5:1 exigido). Se unificó a
`bg-emerald-700`/`hover:bg-emerald-800` (5,5:1) en los 93 botones reales afectados de
toda la app — detalle completo en
[`HALLAZGOS-NUEVOS.md`](HALLAZGOS-NUEVOS.md#h-01) y `design-system.md` §3.1/§6.
Ninguna acción manual pendiente en este punto.

## 4. Limpieza de código muerto pendiente (hallazgo H-04)

`AuthForm.tsx` contiene ~150 líneas de un wizard de alta de jardinero que nunca se
renderiza y cuyo payload `AuthContext.signUp` ignora a propósito (el alta real ocurre
en `/apply`). No afecta a lo que ve el usuario. Es limpieza de código, no diseño:
merece una ronda aparte cuando el usuario lo decida.

## 5. Tras el despliegue

- Reenviar el `sitemap.xml` actualizado en Google Search Console (incluye ahora
  `/costa-del-sol`) para acelerar el indexado de la página nueva.
- Comprobar en producción que `/costa-del-sol` responde y que su `<title>` y canonical
  son los propios de esa página (en local ya está verificado).
