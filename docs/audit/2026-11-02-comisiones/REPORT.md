# Comisiones configurables — informe (2026-11-02)

Rama `feat/comisiones-configurables`. Estado: **implementado y probado en local (SQL en PGlite, TypeScript en vitest, build); sin desplegar; sin probar de punta a punta con funciones y Stripe** (Docker no respondía en la máquina de desarrollo). Las migraciones las aplicas tú.

## 0. En cinco líneas

1. Lo que el código llamaba «gastos de gestión» es tu «comisión»: la paga el cliente encima del precio del servicio; el jardinero cobra el 100 % en mano; GarSer solo ingresa `bookings.management_fee`.
2. El 12,5 % era una constante (`BOOKING_MANAGEMENT_FEE_RATE`). Ahora son **cinco reglas configurables** en **Admin → Comisiones**, guardadas en `commission_settings` (con historial inmutable y auditoría).
3. **Quien decide es SQL**: qué regla toca a cada reserva, el porcentaje y los céntimos. La web solo enseña; el motor de precios entrega el servicio sin comisión; `booking-authority` la completa al firmar el presupuesto; `booking-payment` la revalida contra la versión firmada.
4. Cada reserva guarda **regla, porcentaje, base, versión y fecha** (inmutables). Cambiar los porcentajes no toca reservas ni presupuestos ya firmados.
5. Hay un riesgo que no se puede eliminar (ver §10.1): el origen «enlace» de la **primera** reserva lo declara el navegador.

## 1. Diagnóstico del sistema anterior (resumen)

- **Un solo 12,5 %**: `BOOKING_MANAGEMENT_FEE_RATE = 0.125` en `src/shared/bookingAmounts.ts`, usado solo en `buildQuoteEconomics` (`bookingQuoteCore.ts`). Base: precio bruto del servicio con IVA (siempre euros enteros: `applyMinimumPrice → Math.ceil`).
- **Todo en el servidor**: `booking-authority` firma el presupuesto (`booking_quotes.economic_snapshot`); Stripe cobra `payable_now_amount_cents` del intento (sacado del presupuesto firmado, nunca del navegador), con captura manual. La web no calcula la comisión.
- **Exención del lanzamiento (PR #53)**: `management_fee_waiver_reason()` en SQL → 0 € para «enlace», «cliente con reserva completada» y «visita de plan», con un interruptor en Ajustes.
- **Persistencia**: `bookings.management_fee` + `management_fee_source`, inmutables por trigger; `client_total_price` generada.
- **Tipos de reserva**: solo «con gastos» o «sin gastos». **No se guardaba la procedencia del cliente.**
- **Presupuestos, intentos y reservas solo los escribe el servidor** (`REVOKE` a `anon` y `authenticated`); el rol de admin lo protege un trigger anti-escalada; `is_admin()` mira `profiles.role`.

Riesgos que se detectaron y cómo se han tratado:

| Riesgo | Tratamiento |
|---|---|
| Origen «enlace» declarado por el navegador, no verificable | Se limita (§6) pero **no se elimina** (§10.1) |
| Mínimo de Stripe (0,50 €) sin guardia; con 3 % falla por debajo de 16,67 € | Decisión del dueño: se cobra 0,50 € (`commission_minimum_charge_cents()`) |
| La revalidación del pago usaba el 12,5 % del código | Revalida con la versión firmada (historial) |
| Sin tasa por defecto si falla la lectura | Se bloquea solo la operación económica (503 recuperable) |
| Cuenta en coma flotante de JS y lógica duplicada TS/SQL | Aritmética entera en céntimos, un solo sitio (SQL) |
| Promesas públicas que cuelgan del interruptor | `own_clients_fee_waiver_enabled()` se deriva ahora de las reglas de enlace |
| Valores iniciales pedidos cambian producción | Ver §11 |

## 2. Decisiones del dueño (2026-11-02)

1. **Visita de plan de un cliente del enlace**: paga **3 %** (gana siempre la regla del plan).
2. **Comisión calculada por debajo de 0,50 €**: se cobra **0,50 €**.
3. **Casos dudosos**, aplicados tal cual:
   - «Ya contrató antes» = al menos una reserva **completada** con ese profesional (una cancelada o solo aceptada no cuenta);
   - el origen se guarda en la **primera reserva** con ese profesional y no cambia aunque el cliente vuelva por otro enlace;
   - con otro profesional se decide de nuevo;
   - los clientes existentes: «enlace» si su primera reserva fue `waived_provider_link`, «GarSer» en el resto;
   - el interruptor de Ajustes desaparece, sustituido por las cinco casillas.

## 3. Arquitectura implementada

### 3.1 Las cinco reglas y su prioridad

| Código | Regla | Valor inicial |
|---|---|---|
| `garser_first` | Primera reserva de un cliente captado por GarSer | 12,5 % |
| `link_first` | Primera reserva de un cliente del enlace personal del jardinero | 0 % |
| `garser_repeat` | Reservas posteriores con el mismo jardinero (relación GarSer) | 3 % |
| `maintenance_visit` | Cada visita de un plan de mantenimiento | 3 % |
| `link_repeat` | Reservas posteriores con el jardinero (relación por enlace) | 0 % |

Prioridad (la primera que se cumple, en `resolve_booking_commission`): visita de plan → origen enlace sin reserva completada → origen enlace con reserva completada → origen GarSer sin reserva completada → origen GarSer con reserva completada.

### 3.2 Base de datos (3 migraciones, nada destructivo)

- `20261102130000_commission_settings.sql`: `commission_settings` (una fila, 5 columnas `numeric(5,2)` con CHECK 0–100, `version`), `commission_settings_history` (inmutable) y `commission_settings_audit` (inmutable); un trigger versiona y audita **por cualquier camino**; RPC `get_commission_settings`, `save_commission_settings` (atómica, con versión esperada), `list_commission_audit`, las tres con `is_admin()` en SQL; sin acceso directo desde el navegador.
- `20261102140000_commission_engine.sql`: `client_provider_relationships` (origen por cliente y profesional, inmutable, relleno con las reservas existentes), `resolve_booking_commission`, `apply_commission_to_economics` / `strip_commission_from_economics` (céntimos enteros), `quote_commission_economics`, `commission_snapshot_problem` (verifica contra el historial), cinturón en `booking_payment_attempts`, `own_clients_fee_waiver_enabled()` derivada de las reglas y `management_fee_waiver_reason` fijada a su comportamiento anterior.
- `20261102150000_commission_bookings_and_plans.sql`: columnas `bookings.commission_*` (todo o nada, inmutables, importe coherente con base × porcentaje), registro del origen al crear la primera reserva, y los planes de mantenimiento (`create_maintenance_plan`, `generate_maintenance_proposals`, `maintenance_quote_is_intact`).

### 3.3 Código

- `src/shared/commissionRules.ts`: códigos, textos, validación y formato. Sin imports.
- `src/shared/commissionEngine.ts`: pegamento servidor ↔ SQL (`applyCommission`, `commissionMismatch`), con errores recuperables.
- `bookingQuoteCore.ts`: `buildQuoteEconomics` entrega la economía del **servicio sin comisión** (el precio no cambia); se quita `applyManagementFeeWaiver`.
- `booking-authority` (4 acciones que devuelven economía) y `booking-payment` (revalidación) usan el módulo; nada de porcentajes ni importes del navegador.
- Panel: `src/pages/admin/CommissionSettings.tsx` (+ `src/config/commissionSettings.ts`), ruta `/admin/commissions`, entrada «Comisiones» en el menú. Se retira el interruptor de Ajustes.

### 3.4 Flujo

precio (motor, sin comisión) → `create_quote`: `quote_commission_economics(economía, cliente de la sesión, profesional, origen declarado)` → economía firmada con `commission` → `prepare_payment`: revalida con la versión firmada → intento (el trigger comprueba la comisión contra el historial) → PaymentIntent por `payable_now_amount_cents` (o reserva sin Stripe si 0 €) → `confirm_booking_payment_attempt` crea la reserva y los triggers fijan `commission_*` y el origen.

**Cuándo se fija**: al firmar el presupuesto (`create_quote`), que vive 2 h (las visitas de plan, 72 h). De ahí en adelante nada del panel lo mueve.

## 4. Archivos

**Nuevos**: `supabase/migrations/20261102130000_commission_settings.sql`, `…140000_commission_engine.sql`, `…150000_commission_bookings_and_plans.sql`, `supabase/tests/commission_settings.test.sql`, `scripts/commissions/{pglite-bootstrap.sql,pglite-sql-tests.mjs,verify-commissions.mjs}`, `src/shared/commissionRules.ts` (+test), `src/shared/commissionEngine.ts` (+test), `src/config/commissionSettings.ts`, `src/pages/admin/CommissionSettings.tsx` (+test), este informe.

**Modificados**: `src/shared/bookingAmounts.ts` (fuera la constante; motivo `zero_commission`), `src/shared/bookingQuoteCore.ts`, `supabase/functions/booking-authority/index.ts`, `supabase/functions/booking-payment/index.ts`, `src/pages/admin/{AdminSettings.tsx,AdminLayout.tsx}`, `src/config/appSettings.ts`, `src/App.tsx`, `src/types/generated/database.types.ts` (a mano: regenerar con la CLI cuando Docker responda), `ARCHITECTURE.md`, `docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md` (sección 29), `scripts/readiness/cesped.mjs`, `scripts/fee-waiver/verify-fee-waiver.mjs` (marcado obsoleto), y los tests que fijaban el 12,5 % en el motor.

## 5. Cómo se determina la comisión aplicable

Todo en `resolve_booking_commission(cliente, profesional, origen declarado, ¿visita de plan?, versión)`:
- **Origen**: el guardado en `client_provider_relationships` si existe; si no, el declarado por la web (solo `provider_link`, y solo para el profesional del propio presupuesto); si no, GarSer.
- **¿Primera?**: no existe ninguna reserva `completed` del cliente con ese profesional.
- **Importe**: `round(base × bps / 10000)` en céntimos (a la mitad, hacia arriba); con porcentaje > 0, mínimo 50 céntimos; con 0 %, exenta con motivo (`provider_link`, `returning_client`, `maintenance_plan` o `zero_commission`). La base es el precio del servicio con IVA al firmar (no cambia la de hoy).

## 6. Seguridad

| Amenaza | Control | Prueba |
|---|---|---|
| Un usuario consulta o cambia la configuración | `is_admin()` dentro de las RPC; tablas sin acceso directo; `app_metadata` ignorado | SQL B1–B6, roles reales (anon / authenticated / service_role) |
| Valores inválidos o «arreglados» a 0 | CHECK 0–100, 2 decimales, NOT NULL; validación en la RPC (rechaza, no corrige) y en la web | SQL C6–C9, D5–D7; vitest (72 + 23) |
| Guardado parcial o doble | Un solo `UPDATE`; versión esperada; idempotente; botón y `ref` anti doble clic | SQL C11–C16; vitest «dos clics» |
| Porcentaje, importe, regla o «recurrente» manipulados en la petición | `applyCommission` solo envía datos del servidor; la petición no tiene esos campos | vitest `commissionEngine` |
| Presupuesto o intento adulterado | `commission_snapshot_problem` contra el historial; trigger en `booking_payment_attempts`; la API REST no escribe en esas tablas | SQL G1–G11, H1–H5 |
| Cambiar una reserva ya creada | Trigger de inmutabilidad (`commission_*` y `management_fee`) | SQL I4–I9, I11 |
| Cambiar el origen del cliente | Trigger de inmutabilidad; el origen sale de la primera reserva | SQL E8, E12, E19, E20 |
| Cambio de porcentaje mientras hay un pago en curso | Se revalida con la versión firmada | SQL E23, G11, J10 |

## 7. Estados de una reserva y la comisión

| Estado | Qué pasa con la comisión |
|---|---|
| Borrador / presupuesto | Se fija al firmar; caduca a las 2 h |
| Pendiente de pago | El intento copia la economía firmada; Stripe autoriza `payable_now_amount_cents` |
| Pendiente de aceptar | Reserva creada: `commission_*` y `management_fee` inmutables; la autorización queda retenida |
| Aceptada / completada | Se captura (como antes); completarla es lo que hace que la siguiente cuente como «posterior» |
| Cancelada / rechazada | Se libera o se devuelve según la política de 24 h (sin cambios); no cuenta como «contratación» |
| Cambio de precio aceptado | `total_price` cambia; la comisión ya cobrada **no** se recalcula (diseño anterior, se conserva); `commission_base_amount` guarda la base original |

## 8. Lo que tienes que hacer tú

### Local
- (nada obligatorio) Para el SQL sin Docker: `npm i --no-save @electric-sql/pglite --prefix <carpeta>` y `PGLITE_DIR=<carpeta> node scripts/commissions/pglite-sql-tests.mjs`.
- Con Docker en marcha: `docker exec -i <contenedor_db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/commission_settings.test.sql`, y `supabase functions serve --workdir "$(pwd)"` + `node scripts/commissions/verify-commissions.mjs` (**nunca se ha ejecutado**).
- Regenerar los tipos: `supabase gen types typescript --local > src/types/generated/database.types.ts` (hoy están retocados a mano).

### Producción (en este orden)
1. `supabase db push` — aplica las tres migraciones `20261102130000`, `20261102140000` y `20261102150000`. Con ellas puestas y las funciones antiguas, todo sigue como hasta ahora.
2. `supabase functions deploy booking-authority booking-payment --use-api` (recuerda: el clasificador pide esas palabras exactas).
3. Fusionar la rama (publica la web).
4. Pasar la **sección 29** de `docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md`. 29.6, 29.7 y 29.8 son bloqueantes.
5. Si el panel enseña el aviso ámbar «no usa estas comisiones», falta el paso 2.

**Vuelta atrás**: redesplegar las dos funciones del commit anterior (`git checkout <commit> -- supabase/functions/booking-authority supabase/functions/booking-payment`). Son compatibles con la base de datos nueva (se conservó `management_fee_waiver_reason` con su comportamiento y el interruptor antiguo). Las migraciones no se revierten: las tablas nuevas son inofensivas si no se usan.

## 9. Pruebas ejecutadas (resultados reales, 2026-11-02)

| Qué | Resultado |
|---|---|
| SQL en PGlite (Postgres 18 en WASM): migraciones nuevas sobre las **reales** anteriores, con validación de cuerpos de función, repetibles | ✅ |
| `supabase/tests/commission_settings.test.sql` (109 `check_that` + 30 bloques de error esperado) | ✅ |
| Regresión: `supabase/tests/fee_waiver.test.sql` (el sistema anterior, con las migraciones nuevas puestas) | ✅ |
| Relleno de relaciones con reservas «antiguas» (origen por la primera reserva; la reserva sin cliente no genera relación; no se toca ninguna reserva) | ✅ |
| Permisos con `SET ROLE` anon / authenticated (admin y no admin) / service_role | ✅ |
| Cuenta en céntimos: 6.240 combinaciones importe × porcentaje contra una referencia independiente en BigInt | ✅ 0 diferencias |
| Paridad con el 12,5 % antiguo: los 5.000 precios en euros enteros (1–5.000 €) | ✅ idénticos al céntimo |
| `generate_maintenance_proposals` de punta a punta (propone, íntegra, no duplica) | ✅ |
| vitest completo | ✅ **160 archivos / 1.405 tests** (antes: 157 / 1.278; +127 tests, +3 archivos) |
| Tipos (`tsc`) | ✅ 129 errores antes, 129 después, **0 nuevos** |
| Lint | ✅ 0 errores; 768 avisos antes y después |
| Build | ✅ |
| Panel en el navegador (móvil 375 px y escritorio, datos simulados) | ✅ sin desbordamiento horizontal; campos y botones de 44 px; fuente 16 px; estados de carga, error, validación, guardado y aviso de funciones sin desplegar |

**No probado** (y por qué):
- `scripts/commissions/verify-commissions.mjs` (funciones + Stripe de prueba): Docker no respondía. Está escrito; revisarlo antes de fiarse de un fallo suyo.
- Las edge functions en Deno: solo sintaxis (transpilación de TypeScript); su lógica de comisión está en módulos que sí tienen tests.
- Stripe real y el webhook: sin cambios en su integración; el importe que reciben sale del intento, que el trigger valida.
- La API REST real con tokens de verdad (sección 29.5 y escenario H del script).
- Hay diferencias entre PGlite y el servidor de Supabase (versión de Postgres, extensiones, `auth`): el esquema era un stub mínimo.

Pre-existentes, **no** introducidos: 129 errores de tipos (p. ej. `metaPixel.ts`, `profileNames.ts`, `oauthAccount.ts`) y 768 avisos de lint; los 22 archivos de test que «fallan» en una copia limpia sin `.env` (con variables ficticias pasan todos).

Cambios de un snapshot: `manualEntryPricingParity.test.ts.snap` se regeneró. Comparado entrada a entrada, las 88 entradas vivas son idénticas salvo la comisión (`managementFee`, `payableNow`, línea y cargo de Stripe); además `-u` retiró 5 entradas obsoletas que ningún test usaba (`…-curative-insects 2`).

## 10. Riesgos pendientes y decisiones abiertas

1. **El origen «enlace» de la primera reserva sigue siendo una declaración** (el enlace `/reservar/<id>` es público y los QR ya impresos no se pueden firmar). Cualquier cliente puede declararlo en su primera reserva con cualquier profesional y no pagar. Lo que sí está cubierto: solo vale para ese profesional, solo mientras no haya origen guardado, no cambia nunca después y queda en `commission.claimedOrigin`. **Decisión pendiente**: aceptar el riesgo o enlaces firmados por profesional (rompería los impresos). Hay una consulta útil para vigilarlo: `select client_id, count(*) from client_provider_relationships where origin = 'provider_link' group by 1 having count(*) > 1;`.
2. **Promesas públicas**: «tus clientes reservan sin comisión» (web y materiales) deja de ser exacta para las **visitas de un plan** de un cliente del enlace (3 %). Es consecuencia de tu decisión 1; revisar el texto si importa.
3. **Cliente que repite con GarSer** paga 3 % (antes, con el interruptor encendido, 0 €).
4. **Dos reservas seguidas** antes de completar la primera pagan las dos como «primera» (decisión: solo cuenta lo completado).
5. **Cambio de precio aceptado**: la comisión no se recalcula (igual que antes).
6. **Redondeo**: con precios con céntimos (el motor no los produce) el cálculo exacto difiere en 1 céntimo, en algunos empates de medio céntimo, del que daba la coma flotante antigua (que cobraba 1 céntimo de menos). Con euros enteros no cambia nada.
7. `booking_quotes` se consulta sin índice por `generated_at` para el aviso del panel: irrelevante hoy, revisar si la tabla crece mucho.
8. La skill `garser-pricing-rules` (fuera del repo) todavía dice que el 12,5 % es una constante de `bookingQuoteCore.ts`: está obsoleta en las secciones 4, 9 y 10.8.

## 11. Qué cambia respecto a producción hoy

Con los valores iniciales **12,5 / 0 / 3 / 3 / 0** (los que pediste):
- Cliente nuevo desde garser.es: **igual** (12,5 %).
- Cliente nuevo por el enlace del jardinero: **igual** (0 €).
- Cliente del enlace que repite: **igual** (0 €).
- Cliente de GarSer que repite: **cambia**, de 0 € (interruptor encendido) a **3 %**.
- Visita de un plan: **cambia**, de 0 € a **3 %**.
- Con el interruptor apagado en producción, todo lo anterior ya pagaba 12,5 %: entonces el cambio sería a la baja.
- Importes por debajo de 0,50 €: pasan a cobrarse 0,50 € (antes fallaban en Stripe).
