# Prompt 01 — Cálculo de tiempos: cierre de auditoría (motor único + redeploy)

> Sesión nueva, empiezas en frío. Proyecto **GarSer** (marketplace de jardinería, React+Vite+TS, Supabase + Gemini + Stripe, 7 servicios: césped, setos, árboles, palmeras, arbustos, desbroce, fitosanitarios). Antes de tocar el motor, **invoca la skill `reglas-de-pricing`**.

## Estado actual (verificado 2026-07-11) — la primera pasada YA está hecha

La auditoría base del 2026-07-10 dejó el motor correcto; comprueba con `git log` si está commiteada:

- **SSOT del motor**: `src/shared/bookingQuoteCore.ts` (~1540 líneas), isomórfico, lo importa la Edge Function autoritativa `supabase/functions/booking-authority/index.ts`.
- Las divisiones por yield de **fitosanitarios** están protegidas por las barreras de elegibilidad `missing_yield_config` (verificado).
- **Ya añadido**: clamp de seguridad de `totalHours` a finito no negativo justo antes del descuento >8h y del cálculo de `estimatedHours` (`bookingQuoteCore.ts:~1366`). La regla final de redondeo es `estimatedHours = Math.max(1, Math.ceil(totalHours * 2) / 2)` (medias horas, mínimo 1 h).
- 356/356 tests verdes con estos cambios.

## Qué falta para cerrar este item

1. **⚠️ Redesplegar `booking-authority`** — el motor cambió (clamp) y la Edge Function
   compila su propia copia: `supabase functions deploy booking-authority --use-api`
   (Docker colgado en esta máquina, siempre `--use-api`). Verifica después con una
   reserva real que el quote autoritativo sigue coincidiendo con el preview.
2. **Eliminar los exports muertos de `src/domain/pricingEngine.ts`** (verificado por grep
   de consumidores el 2026-07-11): `calculateLawnPrice` y `calculateTreePrice` **no los
   importa nadie** → borrarlos con sus tests. `calculatePalmPriceEngine` y
   `calculatePalmHoursFromConfig` sí los usa `bookingQuoteCore` (:7), y
   `calculatePalmHoursEngine` solo se usa internamente como fallback — conservar esos tres.
   Con esto desaparece el riesgo de doble motor de precios/tiempos.
3. **Palmeras fallback**: `calculatePalmHoursEngine` (`pricingEngine.ts:137`) actúa de
   fallback cuando el jardinero no tiene `yield_units_per_hour` (`pricingEngine.ts:336-351`).
   Ya se corrigió que per_quantity no cayera siempre a la tabla genérica — reverifica que sigue así.
4. **Documentar la regla de redondeo** en un comentario único junto a `estimatedHours`
   (medias horas + mínimo 1 h + descuento del 10% en trabajos >8 h) si aún no lo está,
   y confirmar que el nº de slots bloqueados en agenda usa exactamente `duration_hours`
   del quote (coherencia con el prompt 02, `BufferService.canBookSequence`).
5. **Traza por servicio** (entregable): tabla de input → yield → multiplicadores →
   `totalHours`, con `file:line` (el bloque grande por servicio está en
   `bookingQuoteCore.ts:1283-1360`). Casos límite: cantidad 0, yield sin configurar,
   `minimum_price`, reservas multi-servicio.
6. **📱 Visibilidad del tiempo de cara al usuario**: verificar que la duración estimada se
   muestra donde se decide — al cliente en `ProvidersPage`/`ConfirmationPage` (franja
   `buildTimeSlotLabel`, `ProvidersPage.tsx:58`) y al jardinero en la tarjeta de solicitud
   ("Duración estimada", `BookingRequestsManager.tsx`) — y que ambas leen `estimatedHours`
   del quote autoritativo, no un recálculo local.

## Verificación

`npm run dev` → una reserva por servicio (o dev-seeds de `src/pages/reserva/detailsPageDevSeeds.ts`) y comparar: horas del preview del cliente, horas del quote de `booking-authority` y nº de slots bloqueados — deben coincidir. Suite: `npx vitest run src/shared/bookingQuoteCore.test.ts`.

## Restricciones

- No romper la firma de `buildAuthoritativeBookingQuote`. Cualquier cambio en `bookingQuoteCore.ts` → redeploy de `booking-authority`.
- Actualiza la memoria `auditoria-precios-transversal.md` con lo que encuentres.
