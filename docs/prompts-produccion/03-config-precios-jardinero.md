# Prompt 03 — Configuración de precios del jardinero: auditoría de paridad UI ↔ motor ↔ BD

> Sesión nueva, en frío. Proyecto **GarSer** (React+Vite+TS, Supabase). **Invoca la skill `reglas-de-pricing`** antes de nada: define rendimientos (`yield_m2_per_hour`, `yield_ml_per_hour`, `yield_units_per_hour`), `precioPorHora`, `price_per_m2`, `minimum_price`, comisión 12,5%, `pricing_method` (`per_hour`/`per_quantity`).

## Estado actual (verificado 2026-07-11)

- El motor (`src/shared/bookingQuoteCore.ts`) fue auditado el 2026-07-09/10: el bug de
  **cero explícito pisado por default** (`x || default` en vez de `x ?? default`, en 6 sitios)
  ya está resuelto con `resolveSurchargePercent` (`bookingQuoteCore.ts:244`), y el fallback
  de palmeras `per_quantity` a la tabla genérica ya no pisa los rendimientos del jardinero.
- Lo que **no** se ha hecho aún es la auditoría sistemática de los **configuradores UI**:
  paridad campo a campo entre lo que edita el jardinero, lo que se persiste y lo que lee el motor.

## Configuradores por servicio (verificado)

- Césped: `src/components/gardener/LawnPricingConfigurator.tsx`
- Setos: `src/components/gardener/HedgePricingConfigurator.tsx`
- Palmeras: `src/components/gardener/PalmPricingConfigurator.tsx`
- Árboles: `src/components/gardener/TreePruningConfigurator.tsx` (`TreePricingConfigurator.tsx` es solo re-export)
- Arbustos: `src/components/gardener/ShrubPricingConfigurator.tsx`
- Desbroce: `src/components/gardener/WeedingPricingConfigurator.tsx`
- Fitosanitarios: `src/components/gardener/PhytosanitaryPricingConfigurator.tsx`
- Comunes: `StandardServiceConfig.tsx`, `ServiceConfigFooter.tsx`, `UnifiedNumericInput.tsx`
- Consumidor/SSOT: `bookingQuoteCore.ts` + `src/utils/hourlyPricing.ts` (`getPricingMethod`, `getPrecioPorHora`)

## Qué falta para producción completa

1. **Matriz de paridad por servicio** (entregable central): variable editable en UI ↔
   campo persistido (tabla/columna/JSON) ↔ campo leído por `bookingQuoteCore`. Cualquier
   variable que el motor use y la UI no exponga (o al revés) es un fallo a corregir.
2. **Persistencia**: a qué tabla/columna va cada config, guardado atómico, sin pérdida al
   recargar. Probar en vivo: configurar → guardar → recargar → releer.
3. **Validaciones de entrada en los configuradores**: prohibir valores absurdos
   (yield ≤ 0 con `per_hour`, precios negativos, NaN por inputs vacíos) pero **permitir `0`
   cuando es semánticamente válido** (recargo 0%) — el motor ya lo respeta; la UI no debe
   impedirlo ni convertirlo.
4. **`pricing_method` claro**: la UI debe dejar explícito el modo (`per_hour` vs
   `per_quantity`) y el motor no debe mezclar (`hourlyPricing.ts:getPricingMethod`).
5. **Coherencia tiempo↔precio**: el rendimiento alimenta a la vez horas y precio; un cambio
   de yield debe mover ambos de forma consistente (verificar con un caso a mano por servicio
   contra `booking-authority`).

## 📱 Mejoras móviles de los configuradores (los jardineros configuran desde el móvil)

Contexto verificado 2026-07-11: los configuradores son grandes (366–803 líneas cada uno;
palmeras 803, fitosanitarios 688, setos 582) y usan `grid grid-cols-1 md:grid-cols-2`
(`StandardServiceConfig.tsx:80`) → en 375px se convierten en **una columna larguísima**.
`UnifiedNumericInput` ya usa `inputMode="decimal"` (✓ teclado numérico correcto) y el
popover de ayuda ya tiene tratamiento móvil con overlay (`StandardServiceConfig.tsx:70-71`).

- [ ] **Botón Guardar sticky abajo** (con `safe-area-inset-bottom`) cuando hay cambios sin
      guardar — en un formulario de 800 líneas el pie se pierde (revisar `ServiceConfigFooter.tsx`).
- [ ] **Secciones colapsables/acordeón** por bloque (tarifa base, rendimientos, recargos,
      extras) para que el jardinero no se pierda en el scroll; abrir la primera por defecto.
- [ ] **Errores de validación inline junto al campo** (no solo toast): en móvil el toast
      tapa poco y desaparece.
- [ ] **Resumen en vivo**: mini-preview del precio/hora resultante con un ejemplo realista
      ("Un césped de 100 m² te saldría en ~X€ / Yh") que se actualiza al editar — reduce
      errores de configuración absurda mejor que cualquier validación.
- [ ] Indicador de cambios sin guardar + aviso al salir (patrón `hasUnsavedChanges` que ya
      usa `AvailabilityManager`).

## Verificación

`npm run dev` como jardinero → configura precios de cada servicio, guarda, recarga (persistencia); como cliente haz una reserva de ese servicio y comprueba que precio y horas usan los valores del jardinero. Suite: `npx vitest run src/shared/bookingQuoteCore.test.ts src/utils/weedingPricing.test.ts src/utils/phytosanitaryPricing.test.ts src/domain/pricing/treePruningPricing.test.ts`.

## Restricciones

- Si tocas el motor, **redespliega `booking-authority`** (`supabase functions deploy booking-authority --use-api`; en esta máquina Docker se cuelga, usar siempre `--use-api`).
- Actualiza la memoria `auditoria-precios-transversal.md` con la matriz de paridad y lo corregido.
