# Prompt 02 — Disponibilidad end-to-end: limpiar el pipeline muerto, endurecer el vivo y pulir el manager móvil

> Sesión nueva, en frío. Proyecto **GarSer** (React+Vite+TS, Supabase). Invoca las skills **`reglas-de-pricing`** (reglas de bloqueo de slots) y **`supabase`** (tablas, RLS, RPC).

## El pipeline REAL (trazado y verificado 2026-07-11) — apréndelo antes de tocar nada

La disponibilidad efectiva es **server-authoritative**. El flujo vivo es:

1. **Config del jardinero** → tabla **`availability`** (`gardener_id, date, start_time, is_available`), un slot por hora:
   - Puntual: `AvailabilityManager.tsx` → `setGardenerAvailability` (`availabilityService.ts` → `availabilityServiceCompat.ts`).
   - Recurrente: `RecurringScheduleManager.tsx` → tablas `recurring_availability_settings` + `recurring_schedules` → RPC `generate_recurring_slots` (con fallback client-side).
2. **Vista del cliente**: `ProvidersPage.tsx` consume `previewProviderQuotes` → Edge Function **`booking-authority`** que lee `availability` (`index.ts:285-293`), resta los holds de pago **`booking_schedule_hold_blocks`** (`index.ts:297-313`) y aplica `min_notice_hours` con DST de Europe/Madrid (`index.ts:354-390`). Devuelve `validStartHours`, `calendarDays`, `earliestSlot` por jardinero.
3. **Bloqueo real**: al pagar, `booking-payment` crea holds; al confirmar, funciones SQL server-side ponen `is_available=false` (migración `20260518151000_booking_payment_confirm_and_hold_guards.sql:260+`). Nada de esto pasa por el cliente.

La ventana horaria vive en `src/utils/availabilityWindow.ts` (7:00–20:00, SSOT creado el 2026-07-10) — la usa la UI del jardinero; en el pipeline del cliente la ventana es implícita (los slots que existan en `availability`).

## 🗑️ SOBRA: cadena client-side entera MUERTA (~1.500 líneas) — eliminarla

Verificado por grep de consumidores el 2026-07-11 — **nadie** importa estos módulos desde código vivo:

| Archivo | Evidencia |
|---|---|
| `src/pages/reserva/AvailabilityPage.tsx` (309 líneas) | Eliminada del flujo (`BookingFlow.tsx:7`: "AvailabilityPage eliminado del flujo"). ⚠️ Además genera disponibilidad **FALSA** con `Math.random()`, jardineros ficticios 'Juan/María/Carlos' y precios aleatorios (líneas 35-82) — peligro si alguien la re-enruta. |
| `src/components/booking/MergedSlotsSelector.tsx` | 0 consumidores. Encima su estado `slots`/`loading` ni siquiera se renderiza dentro del propio componente. |
| `src/components/booking/TimeBlockSelector.tsx` | 0 consumidores. |
| `src/utils/mergedAvailabilityService.ts` | Solo lo importan los dos componentes muertos de arriba. |
| `src/utils/bufferService.ts` | Solo lo importa `mergedAvailabilityService` (muerto). |
| `blockTimeSlots`/`releaseTimeSlots` en `availabilityService.ts` | Solo los consume código muerto; el bloqueo real es server-side. |

Nota: el fix de ventana del 2026-07-10 parcheó en parte estos módulos muertos — al borrarlos no se pierde nada; `generateDailyTimeBlocks` (vivo, usado por `AvailabilityManager`) ya usa el SSOT. Tras el borrado, valora fusionar `availabilityServiceCompat.ts` en `availabilityService.ts` (el comentario "temporary compatibility" ya no se sostiene).

## ❓ FALTA (decisiones de producto a cerrar)

1. **Buffer entre trabajos**: el concepto "margen de desplazamiento entre reservas" solo existía en el `bufferService` muerto. El pipeline real NO deja hueco entre dos trabajos consecutivos de un jardinero. Decidir si se quiere (y entonces implementarlo en `booking-authority`, único sitio válido) o descartarlo explícitamente.
2. **Solicitudes pendientes invisibles en el calendario del jardinero**: `AvailabilityManager` solo pinta reservas `confirmed` (`AvailabilityManager.tsx:146-147`). Una hora con solicitud `pending` se ve libre y el jardinero puede desmarcarla. Mostrar las pendientes con un tercer color/estado.
3. **RPC `generate_recurring_slots`**: confirmar que existe en la BD real; si no, crear la migración o declarar oficial el fallback client-side.
4. **Liberación al cancelar/expirar**: verificar que los slots vuelven a `is_available=true` server-side en cancelación y expiración de holds.

## 🔧 Endurecer `AvailabilityManager` (vivo)

- **N+1 y lentitud**: `fetchWeeklyAvailability` hace 7 llamadas `getGardenerAvailability` secuenciales con `await` en bucle (`AvailabilityManager.tsx:117-132`) → una sola query por rango de fechas.
- **Guardado no atómico**: `saveWeeklyAvailability` lanza un upsert por día con `Promise.all` (`líneas 203-212`); si falla el día 3, los días 1-2 quedan guardados y el toast dice error → guardar en una sola operación (RPC o upsert batch) o informar por día.
- **Limpieza**: 9 `console.log` de debug en el componente; comentario stale "8:00 AM a 8:00 PM" (`línea 37`).
- **Calidad de vida que falta**: "copiar semana anterior" y "aplicar este día a toda la semana" — configurar 13 horas × 7 días a golpe de celda es tedioso, sobre todo en móvil.

## 📱 Mejoras móviles (verificado el layout en código; probar en 375px)

- Las celdas del grid móvil son `h-9` (36 px) con 7 columnas en 375 px (~47 px de ancho): por debajo del target táctil recomendado (44 px). Valorar celdas más altas (`h-11`) y/o gesto de arrastre para marcar rangos en vez de toque por celda.
- El botón **Guardar** queda arriba del calendario (`líneas 419-438`): al hacer scroll por las 13 filas desaparece. Hacerlo sticky abajo (con `safe-area-inset-bottom`) cuando `hasUnsavedChanges`.
- La leyenda (Disponible/Reservado/No disponible) está al final de la página; en móvil se ve DESPUÉS del grid — subirla o hacerla compacta encima del calendario.
- El modal de confirmación ya está bien resuelto (portal, `z-[9999]`, botones grandes).

## Verificación

`npm run dev` (viewport móvil 375px): (1) como jardinero configura semanal + recurrente, recarga y confirma persistencia — marca las **7:00** y comprueba como cliente que se ofrece; (2) reserva y paga → el slot desaparece para otro cliente; (3) cancela → vuelve a estar libre; (4) `npx vitest run` completo tras el borrado del código muerto (ajusta/borra los tests de los módulos eliminados). `npm run build` para confirmar que no queda ningún import roto.

## Restricciones

- Cambios de esquema → migración en `supabase/migrations/`. RLS con la skill `supabase`.
- No reintroduzcas literales 7/8/19/20: usa `availabilityWindow.ts`.
- Si tocas `booking-authority`, redespliega con `supabase functions deploy booking-authority --use-api`.
- Guarda el mapa del pipeline en memoria (`.../memory/disponibilidad-pipeline.md`) e indéxalo en `MEMORY.md`.
