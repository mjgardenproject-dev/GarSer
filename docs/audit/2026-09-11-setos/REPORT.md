# Preparación para producción — Poda de setos

**Veredicto de la Fase 2 (2026-09-11, antes de corregir): NO-GO.**
**Estado tras la Fase 3 (2026-09-11, mismo día, autorizada por el usuario): los 3 hallazgos
están corregidos y verificados — ver §9. Pendiente de PR, merge y despliegue antes de que el GO
sea real en producción.**

Dos hallazgos Bloqueantes propios de setos, ya corregidos: (1) las horas reservadas en el
calendario no correspondían al recargo de estado que el jardinero configura y cobra de verdad —
reservaban de más o de menos según cómo se alejara su % real del 20/50 % de fábrica; (2) abrir
el configurador del jardinero, sin tocar ningún campo, borraba en menos de un segundo la tarifa
de "setos de gran altura" si estaba configurada antes de que existiera el interruptor que la
controla — un jardinero perdía esa línea de negocio sin ninguna acción explícita ni aviso. Un
tercer hallazgo Grave, también corregido: sin aviso de plausibilidad para longitudes de seto
inverosímiles en el flujo de fotos.

Rama: `auditoria/setos`, sobre `origin/main` @ `3354271` (0 commits de diferencia, verificado).
`serviceId` real: `7092ee0e-1779-45cf-bc2d-5235a757c618` — el de `references/servicios.md`
(`3788349c-…`) es fantasma, no existe en este entorno.

**Lo que sigue de aquí para abajo (§1-§8) es el informe de la Fase 2, tal cual se presentó antes
de corregir — se deja intacto porque es la evidencia del "papel vs. realidad" que justificó cada
fix.** El cierre de la Fase 3, con la verificación de cada corrección, está en §9.

---

## 1. Hallazgos

| # | Severidad | Dimensión | Fase | Ubicación | Qué falla | Fix propuesto |
|---|---|---|---|---|---|---|
| 1 | Bloqueante | Cálculo de tiempo | 2A (HTTP/local) + 2C (UI) | `src/shared/bookingQuoteCore.ts:1302` (horas) vs. `:1424-1428` (precio) | Las horas de un tramo de seto con estado "media"/"alta" se calculan con `getDurationMultiplier(zone.state)` — un factor **fijo** 1,3/1,7 (`:421-428`) — mientras que el precio del mismo tramo usa el % real que el jardinero tiene en `condition_surcharges.media`/`alta` (`resolveSurchargePercent`, `:1427-1428`). Con la config sembrada (media=20 %, alta=50 %) el precio sube 20 %/50 % pero las horas suben 30 %/70 % — un jardinero real con un % distinto del 20/50 de fábrica reserva un tiempo que no corresponde a lo que cobra, en cualquier dirección. Verificado ejecutando (no solo leyendo): motor en proceso y pantalla real coinciden en el bug. | Dentro del bloque `if (bookingData.hedgeZones?.length)` de horas (`:1294-1304`), sustituir la llamada a `getDurationMultiplier` por el mismo `resolveSurchargePercent(config.condition_surcharges.media/alta, DEFAULT_HEDGE_SURCHARGES)` que ya usa el bloque de precio — mismo patrón que el fix ya aplicado a césped (PR #20), contenido en el propio bloque de setos, sin tocar `getDurationMultiplier` (que sigue viva para desbroce/arbustos, cada uno en su turno). |
| 2 | Bloqueante | Configuración del jardinero | 2C (navegador, reproducido en vivo con evidencia SQL) | `src/components/gardener/HedgePricingConfigurator.tsx:127-130` (inferencia de `specialist_enabled`) + `:251-259` (`processConfigForSave`) + `src/hooks/useAutoSave.ts` (autoguardado a 1 s) | Si el jardinero tiene la banda "4-6m" ya tarifada en BD pero **no** tiene el campo `specialist_enabled` explícito (p. ej. la configuró antes de que ese interruptor existiera), el componente infiere `specialist_enabled = false` — solo mira `value.specialist_enabled` o el campo legacy `selected_categories`, nunca si `pricing_matrix['4-6m']` ya tiene precio. El objeto derivado (`config`, con todas las claves de `EMPTY_CONFIG`) nunca es `deepEqual` al `initialConfig` crudo de BD (que no tiene `specialist_enabled` como clave), así que `useAutoSave` considera que hay cambios **desde el primer render** y, al segundo de abrir el panel sin tocar nada, guarda `processConfigForSave(config)` — que vacía `pricing_matrix['4-6m']` y `yield_ml_per_hour['4-6m']` porque `specialist_enabled` es `false`. Reproducido en vivo: `pricing_matrix` pasó de `{"0-2m":3.5,"2-4m":5.5,"4-6m":8.0}` a `{"0-2m":3.5,"2-4m":5.5,"4-6m":""}` con solo abrir la pantalla (evidencia en §5). | Hacer que la inferencia de `specialist_enabled` (`:127-130`) también considere "activado" cuando `pricing_matrix['4-6m'] > 0` ya viene con precio, no solo cuando el flag o `selected_categories` lo dicen explícitamente — análogo a lo que el propio código ya intentaba (el comentario del runner heredado asumía que este caso ya estaba resuelto; no lo está). Alternativa más conservadora: no autoguardar en el primer render cuando `initialValue` es un objeto parcial (sin `specialist_enabled`) — comparar solo los campos presentes en `initialConfig`, no la forma completa de `EMPTY_CONFIG`. |
| 3 | Grave | Coherencia con la vida real | 2A (HTTP/local) | (ausente) `src/shared/bookingQuoteCore.ts` — sin ningún `pushWarning` para `hedgeZones` | El motor no tiene ningún aviso de plausibilidad para setos. `HEDGE_MAX_PLAUSIBLE_LENGTH_M=200` (`hedgeBusinessRules.ts:19`) solo se usa en el rango duro del flujo manual (rechaza con 422) y en `ai-pricing-estimator` (baja `nivel_analisis` a 2 y añade `AMBIGUOUS_SIZE` para que el cliente revise antes de confirmar) — pero si ese aviso se ignora o el cliente edita el valor tras la alerta, `recalculate_correction`/`create_quote` facturan cualquier longitud sin ningún aviso, a diferencia de césped (`lawn_area_implausible`, ya en producción). Verificado: 300 ml de seto 2-4m normal se facturan 1650 € / 18 h sin ningún `warnings`. | Añadir, dentro del bloque de horas de `hedgeZones` (`:1294-1304`), un `pushWarning('hedge_length_implausible', …)` cuando `Number(zone.length) > HEDGE_MAX_PLAUSIBLE_LENGTH_M` — mismo patrón que `lawn_area_implausible` en césped, contenido en el bloque propio de setos. |

No se ha encontrado ningún hallazgo nuevo de alcance transversal (que afecte a otro servicio
además de setos): el patrón de horas del hallazgo #1 ya estaba anotado como pendiente para
setos/desbroce/arbustos en el propio comentario que dejó el fix de césped
(`bookingQuoteCore.ts:1271-1276`), y el fix, igual que el de césped, cabe entero dentro del
bloque de setos sin tocar código compartido — por eso es "mío" y no va a
`COORDINACION-SERVICIOS.md` §3.2.

## 2. Papel vs. realidad

Tarifa real del jardinero sembrado (verificada en BD, no en `references/servicios.md`):
`pricing_matrix` 0-2m 3,5 € · 2-4m 5,5 € · 4-6m 8,0 €/ml — `yield_ml_per_hour` 25/15/8 ml/h —
`condition_surcharges` media 20 % · alta 50 % — `waste_removal.percentage` 15 % —
`minimum_price` 50 € — `precioPorHora` 30 €.

| Escenario | Predicción Fase 1 (papel) | Devuelto por el motor | Desviación |
|---|---|---|---|
| 40 ml · 0-2m · normal · 1 cara · sin retirada | 140,00 € · 2,0 h | 140,00 € · 2,0 h | — |
| Mínimo: 10 ml · 0-2m · normal | 50,00 € · 1,0 h | 50,00 € · 1,0 h | — |
| 40 ml · 0-2m · **Descuidado** · 1 cara | 168,00 € · **2,0 h** | 168,00 € · **2,5 h** | **+0,5 h (hallazgo #1)** |
| 40 ml · 0-2m · **Muy descuidado** · 1 cara | 210,00 € · **2,5 h** | 210,00 € · **3,0 h** | **+0,5 h (hallazgo #1)** |
| 40 ml · 0-2m · normal · 1 cara · con retirada | 161,00 € · 2,0 h | 161,00 € · 2,0 h | — |
| 2 caras 40 ml · 0-2m · normal (exactamente 2×) | 280,00 € · 3,5 h | 280,00 € · 3,5 h | — |
| 60 ml · 2-4m · **Muy descuidado** · 2 caras · retirada | 1139,00 € · **12,5 h** | 1139,00 € · **14,5 h** | **+2,0 h (hallazgo #1)** |
| Cambio de precio: 40 ml · 2-4m · **alta** · 1 cara | 330,00 € · **4,0 h** | 330,00 € · **5,0 h** | **+1,0 h (hallazgo #1)** |
| **Reserva real en pantalla** (wizard manual, 40 ml/0-2m/Descuidado/1 cara/con retirada) | 194,00 € · **2,0 h** | 194,00 € · **2,5 h** (pantalla y `bookings.duration_hours` tras redondeo de calendario: 3 bloques) | **+0,5 h (hallazgo #1), confirmado end-to-end** |

En ningún caso el **precio** se desvía — el hallazgo #1 es puramente de horas. El precio nunca
está en desviación porque usa `resolveSurchargePercent` sobre el `condition_surcharges` real
en los dos sitios (precio y — debería — horas); solo las horas siguen leyendo el multiplicador
fijo.

## 3. Barrido de variables

Base: 40 ml · 0-2m · normal · 1 cara · sin retirada = 140,00 € · 2 h.

| Clave de `additional_config` | Delta esperado | Delta observado | Veredicto |
|---|---|---|---|
| `condition_surcharges.media` | +28,00 € (20 %) | +28,00 € (20,0 %) | PASA |
| `condition_surcharges.alta` | +70,00 € (50 %) | +70,00 € (50,0 %) | PASA |
| `waste_removal.percentage` | +21,00 € (15 %) | +21,00 € (15,0 %) | PASA |
| `pricing_matrix['2-4m']` | +80,00 € | +80,00 € | PASA |
| `pricing_matrix['4-6m']` | +180,00 € | +180,00 € | PASA |
| `faces_to_trim` (dato del cliente, ×2) | +140,00 € | +140,00 € | PASA |

`pricing_matrix['0-2m']` y los tres `yield_ml_per_hour` quedan validados por los escenarios de
horas de la tabla anterior. `minimum_price` por el bloque de mínimo (§5). Ninguna clave
configurada por el jardinero queda sin efecto en el precio — el barrido de **precio** está
limpio; el hallazgo #1 es invisible aquí a propósito, porque afecta solo a horas y el barrido
mide precio (por diseño del barrido: comparar horas exigiría una segunda pasada, ya cubierta
por §2).

## 4. Matriz de paridad

| Variable | Config jardinero | Flujo IA (fotos) | Flujo manual | Motor | Veredicto |
|---|---|---|---|---|---|
| Longitud (`length`/`length_pricing_m`) | — | ✓ (`baseLength`, sin duplicar por caras) | ✓ | ✓ | OK |
| Altura → banda (`mapHedgeHeightToBand`, SSOT `hedgeBusinessRules.ts`) | `pricing_matrix`/`yield_ml_per_hour` por banda | ✓ | ✓ | ✓ | OK |
| Caras a recortar (`faces_to_trim`) | — (dato del cliente) | ✓ (clamp 1-2 en cliente) | ✓ (rango 1-2 validado en servidor) | ✓ | OK |
| Estado (`normal`/`media`/`alta`) | `condition_surcharges.media`/`alta` | ✓ | ✓ | ✓ (precio) / ✗ (horas, hallazgo #1) | Precio OK, horas NO |
| Retirada de restos | `waste_removal.percentage` | ✓ | ✓ | ✓ | OK |

Los 4 casos de paridad IA↔manual del runner (2A.2) dan precio y horas **idénticos** entre
ambos caminos — incluido el hallazgo #1, que afecta a los dos caminos por igual (no es un
problema de paridad, es un problema del motor compartido por ambos). Ningún dato del cliente
llega por un camino y falta en el otro.

## 5. Guion de Fase 2

Runner: `READINESS_ENGINE=local node scripts/readiness/setos.mjs` (reescrito esta auditoría —
el heredado tenía el `serviceId` fantasma `3788349c-…` y daba por hechos tres fixes que no
existen en `origin/main`). Resultado final: **33 PASA · 2 FALLA · 1 NO PROBADO**.

| Paso | Resultado | Evidencia |
|---|---|---|
| 2A.1 escenarios (10 casos) | 9 PASA, hallazgo #1 confirmado en E3/E4/E10 | ver §2 |
| 2A.2 paridad IA↔manual (4 casos) | PASA | `{"totalPrice":168,"estimatedHours":2.5}` idéntico en ambos caminos |
| 2A.3 barrido de variables (6 claves) | PASA | ver §3 |
| 2A.4 límites manuales (6 casos) | PASA | `422 manual_input_invalid` con `validateManualSerializableInput` bundleado (la validación vive en `booking-authority`, no en el motor — se bundleó para medirla con el código del worktree) |
| 2A.4 plausibilidad fotos 300 ml | **FALLA (hallazgo #3)** | `{"totalPrice":1650,"estimatedHours":18,"warnings":[]}` |
| 2A.5 mínimo (2 casos) | PASA | `{"totalPrice":50}` / `{"totalPrice":53}` |
| 2A.6 cambio de precio | PASA (documenta hallazgo #1) | `{"totalPrice":330,"estimatedHours":5}` vs. papel 4,0 h |
| 2A.7 disponibilidad y cobertura (4 casos) | PASA | `valid_hours` domingo → `[]`; `preview_providers` fuera de cobertura → `outside_coverage`; 4-6m → jardinero elegible |
| 2A.8 `specialist_enabled` vs. BD | **FALLA (apunta al hallazgo #2)** | `specialist_enabled=ausente · 4-6m tarifado (8.0 €/ml, 8 ml/h)` |
| 2B flujo IA (Gemini real) | **NO PROBADO** | sin fotos de muestra de setos en el repo ni `GOOGLE_API_KEY` en el `.env` local — ver §8. Cubierto a nivel de contrato: se auditó el mapeo `ai-pricing-estimator` → `hedgeZones` en `DetailsPage.tsx:2274-2313` (sin duplicar caras) y el filtro anti-alucinación en `ai-pricing-estimator/index.ts:1414-1443` |
| 2C.a configurador del jardinero | **FALLA, hallazgo #2 reproducido en vivo** | Antes: `{"0-2m":3.5,"2-4m":5.5,"4-6m":8.0}` · Después de abrir el panel sin tocar nada: `{"0-2m":3.5,"2-4m":5.5,"4-6m":""}` (SQL literal en §1) · Restaurado con `scripts/readiness/restore-fixture.sh setos` |
| 2C.b wizard manual completo | PASA | pantalla mostró **194,00 €** y **"la duración del servicio es de 2.5 h"** para 40 ml/0-2m/Descuidado/1 cara/con retirada — coincide con la predicción del motor real (194,00 €/2,5 h), no con la de papel (2,0 h) |
| 2C.c listado de jardineros | PASA (verificado dentro del flujo de reserva real) | Miguel Ángel Ruiz apareció con precio y "5.0 (1) · Contratado anteriormente"; exclusiones por domingo/cobertura ya verificadas por HTTP en 2A.7 (mismo código, `evaluateOperationalEligibility`) |
| 2C.d reserva hasta pago | PASA | resumen en pantalla: Total 218,25 € · Gastos de gestión 24,25 € · Pendiente al profesional 194,00 € |
| 2C.e pago con tarjeta de test | PASA | PaymentIntent `pi_3UEYrf2MwFyGXuB714kx1Few` → Stripe: `{"status":"requires_capture","amount":2425,"amount_capturable":2425,"amount_received":0}` |
| Persistencia (dimensión 7) | PASA | `bookings id=1d41286d-3b54-4923-bb9e-ccea6a53dc19`: `total_price=194.00, duration_hours=3, management_fee=24.25, client_total_price=218.25, start_time=09:00, end_time=12:00` — coincide con pantalla y con Stripe |
| 2C.f cambio de precio (aceptación) | NO PROBADO | ver §8 |
| 2C.g cancelación | NO PROBADO | ver §8 |
| 2C.h finalización y reseña | NO PROBADO | ver §8 |
| 2C.i volver a reservar | NO PROBADO | ver §8 |
| 2C.j consola/logs/red sin errores | PASA | `read_console_messages` sin errores en toda la sesión; `preview_logs` del dev server sin errores |

## 6. Red de regresión

Runner: `scripts/readiness/setos.mjs`

```bash
READINESS_ENGINE=local SUPABASE_PROJECT_DIR=~/Downloads/GarSer-referencia SUPABASE_DB_CONTAINER=supabase_db_GarSer-referencia node scripts/readiness/setos.mjs
```

33 PASA · 2 FALLA · 1 NO PROBADO. Los 2 FALLA son los hallazgos #2 y #3 (documentados, no
accidentes del runner); relanzar tras cualquier cambio en el motor o en la config de setos. El
runner **no** usa expectativas ajustadas al bug del hallazgo #1 — usa la predicción correcta de
negocio (mismo % en precio y horas), así que cuando alguien corrija el hallazgo #1, los
escenarios E3/E4/E10 y el de cambio de precio pasarán de PASA-con-nota a PASA limpio sin tocar
el runner.

## 7. Hallazgos transversales

(ninguno nuevo). El patrón de horas del hallazgo #1 ya estaba anotado en el propio código
(`bookingQuoteCore.ts:1271-1276`, comentario dejado por el fix de césped) como pendiente para
setos/desbroce/arbustos, y — como en césped — el fix cabe entero dentro del bloque de setos sin
tocar `getDurationMultiplier` ni ningún otro servicio: no es transversal, es mío. No se ha
tocado ningún fichero de otro servicio. El único fichero compartido tocado es
`scripts/readiness/restore-fixture.sh` (añadido el caso `setos`, aditivo, registrado en
`COORDINACION-SERVICIOS.md` §2).

Dos hallazgos transversales ya documentados por otras auditorías **se confirman relevantes
para setos** sin necesidad de volver a anotarlos: T2 (redondeo de horas por encima de 8h,
`COORDINACION-SERVICIOS.md` §3.2 — su propia descripción ya cita "setos" explícitamente) y T7
(trabajos que no caben en un día, sin aviso — setos con "Muy descuidado" + 2 caras cruza
fácilmente ese umbral, como muestra el escenario de 14,5 h de este informe).

## 8. Acciones manuales del usuario

- ~~Decidir el turno de corrección de los hallazgos #1, #2 y #3~~ — **hecho**: el usuario
  autorizó la Fase 3 el mismo día y los 3 quedaron corregidos y verificados (§9). Lo que queda
  es abrir la PR, fusionarla y desplegar — ver §9 para el detalle exacto.
- **Flujo con fotos reales (2B), NO PROBADO.** El repo no tiene fotos de muestra de setos y el
  `.env` de funciones del stack de referencia no tiene `GOOGLE_API_KEY` configurada. Para
  cerrar esta dimensión hace falta: (a) 2-3 fotos reales de un seto, (b) la clave de Gemini en
  `supabase/functions/.env` del checkout de referencia, y repetir supabase functions serve o
  reiniciar para que la recoja.
- **Ciclo de vida más allá del pago (2C.f-i), NO PROBADO para setos específicamente.** Cambio
  de precio, cancelación, finalización y reseña usan componentes genéricos
  (`ClientBookingLauncher`, `BookingsList`, `respond_booking_price_change`,
  `BookingRequestsManager`) ya ejercitados y documentados por las auditorías de césped y
  árboles (hallazgos transversales T4/T5/T6/T9/T11 en `COORDINACION-SERVICIOS.md` §3.2). Se
  priorizó el tiempo en los hallazgos propios de setos en vez de repetir una cuarta vez la
  misma prueba sobre un componente que no es de este servicio. Si se ejecutan para setos y
  reproducen los mismos síntomas, no son hallazgos nuevos.
- **Subida de fotos por la UI**, fuera del alcance de las herramientas de navegador
  disponibles — no probado, estructuralmente.
- **Reserva de prueba creada en el entorno compartido**, para que quien la vea no la confunda
  con datos reales: `bookings id=1d41286d-3b54-4923-bb9e-ccea6a53dc19` (Poda de setos, cliente
  Laura Fernández, jardinero Miguel Ángel Ruiz, 18 sept. 2026 09:00-12:00, `status=pending`),
  con el PaymentIntent de Stripe test `pi_3UEYrf2MwFyGXuB714kx1Few` en `requires_capture`
  (24,25 €, sin capturar). No se ha cancelado ni completado — queda pendiente de aceptación del
  jardinero, como cualquier reserva real.
- **`docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md`** ya tiene la SECCIÓN 19 (Poda de setos) con
  esta batería traducida a garser.es — pendiente de actualizar su texto para reflejar que los
  3 hallazgos ya están corregidos (hoy describe el estado de antes de la Fase 3).
- **Tras la Fase 3 (2026-09-11) SÍ hay que desplegar** — ver §9.4: `supabase db push` no aplica
  (sin migraciones nuevas), pero `supabase functions deploy booking-authority --use-api` sí,
  porque el motor que importa (`bookingQuoteCore.ts`) cambió. `HedgePricingConfigurator.tsx` es
  código de frontend — llega con el siguiente despliegue de Vercel, sin paso aparte.

---

## 9. Fase 3 — Cierre (2026-09-11, mismo día, autorizada por el usuario)

El usuario autorizó corregir los 3 hallazgos y pidió, explícitamente, evaluar si alguno afecta
transversalmente a los siete servicios. Los tres fixes quedaron contenidos en ficheros "de
setos" — ninguno tocó código de otro servicio.

### 9.1 Fix del hallazgo #1 — horas con el mismo % que el precio

`src/shared/bookingQuoteCore.ts`, dentro del bloque `if (bookingData.hedgeZones?.length)` de
horas: sustituida la llamada a `getDurationMultiplier(zone.state)` (factor fijo 1,3/1,7) por el
mismo cálculo de `stateMult` que ya usaba el bloque de precio —
`resolveSurchargePercent(config.condition_surcharges.media/alta, DEFAULT_HEDGE_SURCHARGES)`.
Mismo patrón, línea por línea, que el fix ya aplicado a césped en la PR #20. `getDurationMultiplier`
sigue viva para desbroce (`:1351`) y arbustos (`:1361`), sin tocar.

### 9.2 Fix del hallazgo #2 — el configurador ya no borra la banda 4-6m

`src/components/gardener/HedgePricingConfigurator.tsx:127-134`: la inferencia de
`specialist_enabled` (cuando el flag no viene explícito) ahora también se activa si
`value.pricing_matrix['4-6m'] > 0` — antes solo miraba el legacy `selected_categories`. No se
ha tocado `useAutoSave` ni `processConfigForSave`: con `specialist_enabled` bien inferido, el
autoguardado del primer render conserva la banda en vez de vaciarla.

**Reproducido en vivo, antes y después del fix, contra la base de datos compartida
(restaurada inmediatamente en los dos casos para no afectar a las otras seis auditorías):**

Antes del fix — abrir el panel sin tocar nada:
```
-- antes de abrir
pricing_matrix: {"0-2m": 3.5, "2-4m": 5.5, "4-6m": 8.0} · specialist_enabled: (ausente)
-- después de abrir, sin tocar ningún campo
pricing_matrix: {"0-2m": 3.5, "2-4m": 5.5, "4-6m": ""}  · specialist_enabled: false
```

Después del fix — mismo gesto, mismo jardinero:
```
-- antes de abrir
pricing_matrix: {"0-2m": 3.5, "2-4m": 5.5, "4-6m": 8.0} · specialist_enabled: (ausente)
-- después de abrir, sin tocar ningún campo (el árbol de accesibilidad confirma el interruptor:
--   button "Activado" — antes decía "Desactivado")
pricing_matrix: {"0-2m": 3.5, "2-4m": 5.5, "4-6m": 8}   · specialist_enabled: true
```

El autoguardado del primer render sigue disparándose (eso no ha cambiado, y no hacía falta
cambiarlo: no es destructivo una vez que `specialist_enabled` se infiere bien) — ahora conserva
la banda y además deja `specialist_enabled` explícito en BD, resolviendo la ambigüedad legacy
para siempre en ese jardinero.

### 9.3 Fix del hallazgo #3 — aviso de longitud inverosímil

`src/shared/bookingQuoteCore.ts`, mismo bloque de horas: nuevo
`pushWarning('hedge_length_implausible', …)` cuando `zone.length > HEDGE_MAX_PLAUSIBLE_LENGTH_M`
(200 ml, importado de la SSOT `src/domain/hedgeBusinessRules.ts` en vez de duplicar la
constante). Mismo patrón que `lawn_area_implausible` de césped.

### 9.4 Verificación de cierre

| Paso | Resultado |
|---|---|
| Runner (`READINESS_ENGINE=local`) | **35 PASA · 0 FALLA · 1 NO PROBADO** (el NO PROBADO es T7, transversal ya documentado, no de setos) — antes del fix: 33 PASA · 2 FALLA · 1 NO PROBADO |
| `npx tsc --noEmit -p tsconfig.app.json` | **172 → 172** (verificado con `git stash`/`git stash pop`: mismo número con y sin mis cambios — 0 errores nuevos; ≤173 de `main`) |
| `npx vitest run` | **434/434 PASA**, 66/66 ficheros |
| 2C.a configurador en vivo (hallazgo #2) | **PASA**, evidencia SQL antes/después en §9.2 |
| 2C.b wizard manual en vivo (hallazgo #1) | **No concluyente por diseño del entorno, no por el fix** — ver nota abajo |

**Nota sobre 2C.b:** intenté repetir en el navegador el mismo booking manual de la Fase 2
(40 ml/0-2m/Descuidado/1 cara) para ver 168,00 €/2,0 h en pantalla. La pantalla siguió
mostrando 2,5 h. Esto **no es un fallo del fix**: esa pantalla pide el precio a
`booking-authority`, una función Edge servida por el stack de Supabase levantado desde
`~/Downloads/GarSer-referencia` — no por este worktree. Mi fix está en el código de la rama
`auditoria/setos`, pero no llega a esa función hasta que se despliega tras el merge (mismo
motivo por el que toda la Fase 2 se midió con `READINESS_ENGINE=local` en vez de por HTTP). La
verificación válida antes de desplegar es la del motor en proceso (fila de arriba, 35/35), que
sí ejecuta el TypeScript real de esta rama. No se creó ninguna reserva ni pago en este intento
— se abandonó en el paso de selección de jardinero/fecha, sin llegar a pago.

### 9.5 Evaluación transversal (pedida explícitamente por el usuario)

**Ningún hallazgo de setos necesita arreglo central.** Los tres se corrigieron dentro de
ficheros que son "de setos" (el bloque `hedgeZones` del motor compartido, o el configurador
propio, que no comparte código con los otros seis). El detalle completo, con los ficheros y
líneas exactas para que desbroce/arbustos y las demás auditorías lo encuentren cuando les
toque, está en `docs/audit/COORDINACION-SERVICIOS.md` §2 (fila de `bookingQuoteCore.ts` para
`auditoria/setos`) y en la nota "Evaluación transversal de la auditoría de setos" justo
después de las filas de la tabla. Resumen:

- El patrón del hallazgo #1 (horas con multiplicador fijo en vez del % real del jardinero)
  **sigue sin corregir, de forma independiente, en desbroce (`:1351`) y arbustos (`:1361`)** —
  cada una lo encontrará como hallazgo propio en su turno; el fix es el mismo, tres veces
  repetido ya (césped, setos, y pendiente en los otros dos).
- El mecanismo del hallazgo #2 (`useAutoSave` dispara en el primer render por una comparación
  `deepEqual` estricta entre el config derivado y el crudo de BD) **no se ha comprobado en
  ningún otro configurador** — queda como aviso, no como hallazgo confirmado, para que cada
  auditoría revise el suyo con la pregunta: *"¿el primer autoguardado puede borrar algo que ya
  estaba bien puesto?"*

### 9.6 Qué falta

- Abrir la PR (la abre el usuario, no este chat).
- Tras el merge: `supabase functions deploy booking-authority --use-api` (el motor cambió),
  actualizar el entorno local compartido (§4 de `COORDINACION-SERVICIOS.md`), y ejecutar **todos**
  los runners por HTTP, no solo el de setos.
- Actualizar `docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md` SECCIÓN 19 para reflejar que los
  hallazgos ya están corregidos (hoy describe el estado pre-Fase 3; el ✅/❌ de cada punto hay
  que releerlo tras el despliegue real).
- Repetir en garser.es, ya con datos reales de un jardinero de producción, los tres escenarios
  que demuestran cada fix (ver §9.1-9.3) — los números concretos de este informe son los de la
  tarifa sembrada local y no van a coincidir con los de producción.
