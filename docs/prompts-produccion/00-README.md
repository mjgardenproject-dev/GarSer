# Prompts de producción GarSer — índice y estado

> ✅ **EJECUTADO (2026-07-11)**: los 8 items fueron aplicados en profundidad y commiteados
> (commits `2f5e079`…`b96d6e3`), con migraciones aplicadas en la BD remota y las 3 Edge
> Functions redesplegadas. 356/356 tests, build verde, funnel verificado en vivo a 375px.
> Esta carpeta queda como REGISTRO del análisis; los pendientes que siguen vivos son
> manuales: plantillas de Supabase Auth (Dashboard), imágenes de la tabla `services`,
> restricciones de la API key de Google Maps en producción, y E2E con cuentas reales.

Cada archivo de esta carpeta es un **prompt autónomo** (rutas y líneas verificadas el 2026-07-11, antes de la ejecución).

## Estado por item (2026-07-11)

| # | Item | Estado | Lo que falta |
|---|------|--------|--------------|
| 01 | Cálculo de tiempos | 🟡 Casi cerrado | Borrar exports muertos de `pricingEngine`; **redesplegar `booking-authority`** (el motor cambió) |
| 02 | Disponibilidad end-to-end | 🟠 Pipeline real trazado | **Borrar la cadena client-side muerta (~1.500 líneas, incluida una página con disponibilidad FAKE)**, endurecer `AvailabilityManager` (N+1, guardado no atómico, pendientes invisibles), decidir buffer entre trabajos |
| 03 | Config precios jardinero | 🟡 Motor verificado | Paridad UI↔motor↔BD por servicio + UX móvil de configuradores (acordeón, guardar sticky, preview en vivo) |
| 04 | Formulario ser jardinero | 🟡 3 bugs corregidos | Validaciones (`type="tel"`), compresión de subidas, autosave, reenvío tras rechazo |
| 05 | Chat nuevo móvil | 🔴 Solo mensajes de sistema | **Aplicar migración** + rediseño completo: aceptar precio en chat, bug de leídos con `sender_id NULL`, N+1, optimista, back móvil, lightbox |
| 06 | Emails automáticos | 🔴 Solo capa de marca | **Deploy pendiente** + todos los tipos + plantillas Auth + text/plain y QA móvil/dark-mode |
| 07 | Botón ubicación actual | 🟢 Hecho y verificado en vivo | Checklist de producción (API key, HTTPS) + pulido: CTA sin loading, coords del autocompletado, doble cabecera del funnel |
| 08 | Tarjetas servicio jardinero | 🟡 Detalle manual hecho | Detalle para reservas IA/fotos, lightbox, paridad en confirmadas, confirmar "Completado", llamar/navegar al cliente |

> Profundizado el 2026-07-11 con análisis de código + pasada en vivo a 375px: cada prompt
> incluye ahora secciones **"FALTA"** (funciones que un producto en producción necesita),
> **"SOBRA"** (código muerto/ineficiencias verificadas por grep) y **"📱 móvil"** (mejoras
> de diseño concretas con `file:line`).

## Operaciones pendientes (independientes de los prompts)

1. **Commit** de la pasada del 2026-07-10 (si `git status` aún muestra los cambios).
2. `supabase db push` → aplica `supabase/migrations/20260710120000_chat_system_messages.sql`.
3. `deno check supabase/functions/send-email-notification/index.ts` + `supabase functions deploy send-email-notification --use-api`.
4. `supabase functions deploy booking-authority --use-api` — **obligatorio**: `src/shared/bookingQuoteCore.ts` cambió (clamp de `totalHours`) y la Edge Function lo importa.

(En esta máquina Docker Desktop se cuelga: usar siempre `--use-api` para desplegar funciones.)

## Orden recomendado

Operaciones pendientes → 05 (chat) → 06 (emails, comparte eventos con el chat) → 08 → 02 → 03 → 01 → 04 → 07.

## Reglas comunes a todas las sesiones

- Proyecto: **GarSer**, marketplace de jardinería. React 18 + Vite + TypeScript, Tailwind 3, Lucide, Supabase (Auth + Postgres + Edge Functions Deno + Realtime + Storage), Gemini 2.5 Flash, Stripe. 7 servicios: césped, setos, árboles, palmeras, arbustos, desbroce, fitosanitarios.
- **SSOT de precios y tiempos**: `src/shared/bookingQuoteCore.ts` (isomórfico, lo importa la Edge Function `supabase/functions/booking-authority`). Antes de tocarlo, invoca la skill **`reglas-de-pricing`**. Si tocas el motor, **redespliega `booking-authority`** con `--use-api`.
- Verificación en vivo: `npm run dev` y comprobar el flujo en el navegador, no solo tests. Suite completa: `npx vitest run` (356 tests, ~5 s).
- Skills útiles: `reglas-de-pricing`, `garser-production-audit`, `garser-manual-entry`, `garser-ai-analysis-flows`, `diseno-web-cliente` (SOLO páginas de cara al cliente), `supabase`.
