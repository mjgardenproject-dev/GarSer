# Preparación para producción — Corte de césped

**Veredicto: NO-GO**

Cuatro bloqueantes: dos propios de césped (arreglables en esta rama) y dos transversales
(compartidos con otros servicios, se anotan y no se tocan aquí). Ninguno pierde dinero
directamente, pero dos de ellos hacen que la agenda del jardinero no refleje el trabajo real
y uno deja al cliente sin forma de responder a una propuesta de precio desde la pantalla que
ve primero.

1. **[Propio]** Las horas de césped "descuidado"/"muy descuidado" usan un multiplicador fijo
   (1,3/1,7) que ignora el recargo de estado que el jardinero configura — el PRECIO de esas
   mismas zonas sí usa ese recargo. Un jardín de 1000 m² muy descuidado calcula 10,5 h en vez
   de las 9,0 h coherentes con el 50 % que el jardinero cobra de más, y con eso deja de caber
   en cualquier día de la semana sembrado (máximo 10 bloques), dejando al jardinero sin
   ningún hueco reservable para ese trabajo. §1.1
2. **[Propio]** El flujo de fotos no tiene ningún tope ni aviso de plausibilidad para la
   superficie de césped — ni el que sí tiene el flujo manual (5000 m²) ni un aviso propio.
   Probado con 50 000 m²: precia 9000 €/300 h sin un solo warning. §1.2
3. **[Transversal — no se arregla en esta rama]** Al aceptar una propuesta de cambio de
   precio, `duration_hours` y la agenda quedan congelados en el valor anterior a la
   corrección; solo cambia el precio. Probado end-to-end: 1000→1400 m², precio 216→303 €
   correcto, horas siguen en 8 cuando el propio motor dice que deberían ser 11. §7, T4
4. **[Transversal — no se arregla en esta rama]** El botón "Aceptar nuevo precio"/"Rechazar"
   del **dashboard** del cliente (la pantalla de inicio, lo primero que ve al entrar) no hace
   nada al pulsarlo — ni con clic real ni programático. Los mismos botones sí funcionan en
   "Mis reservas" → "Ver todas". §7, T5

Grave adicional, no bloqueante por sí solo pero relacionado con el bloqueante 1: el redondeo
de horas por coma flotante (`bookingQuoteCore.ts:1349-1350`) está confirmado con una entrada
real de césped, no solo sospechado — ver §7, T2. Es transversal, tampoco se arregla aquí.

---

## 1. Hallazgos (propios de césped — arreglables en esta rama)

| # | Severidad | Dimensión | Fase | Ubicación | Qué falla | Fix propuesto |
|---|---|---|---|---|---|---|
| 1 | Bloqueante | Cálculo de tiempo | 2A / 2C | `src/shared/bookingQuoteCore.ts:1263` (llama a `getDurationMultiplier`, definida en `:412-419`, fija en 1.0/1.3/1.7) vs `:1438-1439` (precio, usa `resolveSurchargePercent(config.condition_surcharges...)`) | Las horas de césped "descuidado"/"muy descuidado" no leen `condition_surcharges` del jardinero — usan un multiplicador fijo distinto del que sí usa el precio para el mismo estado. Con el jardinero sembrado (recargo 20 %/50 %), esto se camufla en "descuidado" por el redondeo del ajuste `>8h`, pero es real y medible en "muy descuidado" (10,5 h reales vs 9,0 h coherentes) y en cualquier corrección de precio con superficie mayor. Consecuencia directa: un trabajo de 1000 m² muy descuidado queda sin ningún hueco reservable en 21 días porque el motor infla las horas por encima de la capacidad de un día laborable (10 bloques), cuando con el cálculo coherente sí cabría. | Sustituir, **solo dentro del bloque `if (bookingData.lawnZones?.length)` de horas** (`:1259-1265`), el multiplicador fijo por el mismo `resolveSurchargePercent(config.condition_surcharges.descuidado/muy_descuidado, …)` que ya usa el bloque de precio. No tocar `getDurationMultiplier` en sí (la usan setos/desbroce/arbustos) ni esos otros bloques — eso es de sus auditorías. |
| 2 | Grave | Coherencia con la vida real | 2A | Falta un `pushWarning` para césped en `src/shared/bookingQuoteCore.ts` (solo existen para palmeras `:1284` y árboles `:1292`) · `booking-authority/index.ts:530-531` confirma que la validación manual es "inert for the photo flow" | El flujo de fotos no tiene ningún tope de superficie ni aviso de plausibilidad. El propio prompt a Gemini pide un rango de 1-2000 m² (`supabase/functions/ai-pricing-estimator/new_prompts.ts:170-171`) pero es una instrucción al modelo, no una validación server-side: si Gemini no la respeta (o alucina una medida), nada lo detiene. Probado: `recalculate_correction` con 50 000 m² por el camino de fotos precia 9000 €/300 h sin ningún warning. El camino manual sí tiene un tope real (`MANUAL_RANGES.lawn.superficie_m2 = {min:1, max:5000}`, verificado con 422 `manual_input_invalid` tanto en local como por HTTP). | Añadir un `pushWarning('lawn_area_implausible', …)` en el bloque de césped, análogo al de palmeras/árboles, cuando la superficie declarada por fotos supere un umbral (p. ej. 2000 m², alineado con el propio prompt). |

## 2. Papel vs. realidad

Todas las predicciones de la Fase 1 se recalcularon a mano contra la configuración real del
jardinero sembrado (verificada en BD, no asumida de la skill ni del runner heredado) y se
contrastaron ejecutando el motor en proceso (`READINESS_ENGINE=local`) y, en los puntos
marcados, también por HTTP contra el stack de referencia.

| Escenario | Predicción Fase 1 | Devuelto por el motor | Desviación |
|---|---|---|---|
| 1000 m² normal, sin retirada | 180,00 € · 7 h | 180,00 € · 7 h | — |
| 100 m² normal (mínimo) | 45,00 € · 1 h | 45,00 € · 1 h | — |
| 1000 m² descuidado, sin retirada | 216,00 € · 8 h | 216,00 € · 8 h | — |
| 1000 m² muy descuidado, sin retirada | 270,00 € · 10,5 h¹ | 270,00 € · 10,5 h | — |
| 1000 m² normal, con retirada | 207,00 € · 8 h | 207,00 € · 8 h | — |
| 1000 m² descuidado, con retirada | 249,00 € · 9 h¹ | 249,00 € · 9 h | — |
| 6000 m² normal, sin retirada | 1080,00 € · 36 h | 1080,00 € · 36 h | — |
| Cambio de precio: 1400 m² descuidado | 303,00 € · 11 h¹ | 303,00 € · 11 h | — |
| Manual, frontera 5000 m² normal | 900,00 € · 30,0 h² | 900,00 € · **30,5 h** | **+0,5 h (BLOQUEANTE, ver T2 en §7)** |
| Manual, 5001 m² (fuera de rango) | 422 `manual_input_invalid` | 422 `manual_input_invalid` (verificado por HTTP) | — |

¹ Estos tres valores son los que el motor **realmente** produce con el multiplicador de horas
fijo (hallazgo #1). Si las horas usaran el mismo recargo configurado que el precio, serían
9,0 h / 8,5 h / 10,5 h respectivamente — la diferencia con lo que el motor devuelve es
precisamente el hallazgo, no un error de mi predicción: acerté a predecir el código tal y
como está escrito hoy, que es lo que exige esta tabla.

² Matemáticamente exacto: `(5000/150)·0,9 = 30` sin resto. El motor da 30,5 por el residuo de
coma flotante de T2 — la única fila de esta tabla donde predicción y ejecución divergen de
verdad, y por eso es la única bloqueante de esta sección.

## 3. Barrido de variables

| Clave de `additional_config` | Delta esperado | Delta observado | Veredicto |
|---|---|---|---|
| `price_per_m2` | 180,00 € (base, 0,18×1000) | 180,00 € | PASA |
| `yield_m2_per_hour` | 7 h (1000/150) | 7 h | PASA |
| `condition_surcharges.descuidado` | +36,00 € (20 %) | +36,00 € (20,0 %) | PASA |
| `condition_surcharges.muy_descuidado` | +90,00 € (50 %) | +90,00 € (50,0 %) | PASA |
| `waste_removal.percentage` | +27,00 € (15 %) | +27,00 € (15,0 %) | PASA |
| `minimum_price` | 45 € con 99/250 m²; 46 € con 251 m² | 45,00 € / 45,00 € / 46,00 € | PASA |

Todas las claves de precio están conectadas al motor y respetan lo configurado. El barrido
de **precio** no detecta el hallazgo #1 porque el precio en sí es correcto — solo se ve
comparando precio y horas para el mismo recargo (ver §2 y el propio runner, bloque 2A.3b).

También verificado en el configurador del jardinero (2C.a): cambié `price_per_m2` de 0,18 a
0,25 en la UI, guardó solo (autosave), y `recalculate_correction` devolvió inmediatamente
`250,00 €` para 1000 m² (antes 180,00 €) — el cambio se revirtió a 0,18 al terminar la prueba
para no afectar a las otras seis auditorías que comparten esta base de datos.

## 4. Matriz de paridad

| Variable | Config jardinero | Flujo IA | Flujo manual | Motor | Veredicto |
|---|---|---|---|---|---|
| Superficie (m²) | — | NO PROBADO¹ | ✓ (wizard real, cliente y jardinero) | ✓ | Manual↔motor verificado end-to-end |
| Estado (normal/descuidado/muy descuidado) | ✓ (3 valores configurados) | NO PROBADO¹ | ✓ | ✓ | ídem |
| Retirada de restos | ✓ | NO PROBADO¹ | ✓ | ✓ | ídem |

¹ `GOOGLE_API_KEY` no está configurado en el `.env` de funciones del entorno local
(`supabase/functions/.env` solo tiene `LIFECYCLE_TICK_SECRET` y `STRIPE_SECRET_KEY`), así que
no se puede invocar `ai-pricing-estimator` de verdad. **Esto no es un fallo del servicio**: es
un secreto que falta en el entorno de prueba. Ver acciones manuales, §8.

Paridad verificada **a nivel de motor** (2A.2, `READINESS_ENGINE=local`): el mismo par
`{quantity, state, wasteRemoval}` enviado con la forma del payload de fotos y con la forma
del payload manual da precio y horas **idénticos** en los 5 casos probados (incluyendo un
caso con retirada de restos y otro con estado muy descuidado). La paridad se rompe solo en
que ambos caminos heredan el hallazgo #1 por igual — no es una asimetría entre caminos, es un
fallo del motor que los dos comparten, así que no aparece como "solo IA" o "solo manual" en
esta tabla.

## 5. Guion de Fase 2

| Paso | Resultado | Evidencia |
|---|---|---|
| 2A — Runner completo (`scripts/readiness/cesped.mjs`, `READINESS_ENGINE=local`) | 24 PASA · 6 FALLA · 4 NO PROBADO | Salida completa del runner, ver más abajo |
| 2A.4 — Límites manuales (5001 m², estado inválido, 0 m²) | PASA (verificado por HTTP puntual, ver nota) | `{"error":"...","code":"manual_input_invalid","validationErrors":[{"field":"lawnZones[0].quantity","code":"out_of_range","message":"la superficie de césped debe estar entre 1 y 5000."}]}` |
| 2B — Flujo IA (Gemini) | NO PROBADO | Falta `GOOGLE_API_KEY` en el entorno local |
| 2C.a — Configurador del jardinero | PASA | 6 campos de UI ↔ 6 claves de `additional_config`, valores exactos; cambio de precio verificado end-to-end (ver §3) |
| 2C.b — Wizard manual completo (cliente) | PASA | 1000 m² descuidado sin retirada → pantalla mostró **243,00 € total · 216,00 € al profesional · 8 h**, idéntico a la predicción S3 |
| 2C.c — Listado de jardineros | PASA | Miguel Ángel Ruiz aparece con precio y huecos; domingo sin huecos y dirección fuera de cobertura excluida, verificados por API (2A.7) |
| 2C.d — Reserva y desglose | PASA | `bookings`: `total_price=216.00, duration_hours=8, management_fee=27.00, client_total_price=243.00` |
| 2C.e — Pago con tarjeta de test | PASA | Stripe `pi_3UERDP2MwFyGXuB703i3t5vX`: `status=requires_capture, amount=2700, amount_capturable=2700` (captura diferida, diseño correcto según HALLAZGOS-CONOCIDOS.md) |
| 2C.f — Cambio de precio (jardinero propone, cliente acepta) | PASA con 2 hallazgos | Precio recalculado automáticamente a **303 €** (exacto); aceptado desde "Ver todas" → `total_price=303.00`. Ver hallazgo transversal T4 (duración no se actualiza) y T5 (botón roto en dashboard) |
| 2C.g — Cancelación con reembolso (>24h) | PASA | Stripe `pi_3UERQb2MwFyGXuB71FAbyHdZ`: `status=canceled, amount_capturable=0, amount_received=0`; UI: "No se te ha cobrado nada" |
| 2C.h — Finalización y reseña | PASA | `gardener_finished_at` seteado → cliente confirma → `bookings.status=completed` → reseña `rating=5.0` persistida → `public_gardener_directory.rating_average=5.00, rating_count=1` |
| 2C.i — Volver a reservar | PASA | Repite servicio con Miguel Ángel Ruiz, muestra "Contratado anteriormente · 5.0 (1) ver reseñas", precio recalculado con tarifas vigentes |
| 2C.j — Consola/logs/red | PASA con nota | Sin errores de aplicación; un único `ERR_CONNECTION_REFUSED` corresponde a las imágenes de servicio rotas (pendiente ya conocido, `produccion-8-items.md`, no es nuevo) |

**Salida completa del runner** (`READINESS_ENGINE=local node scripts/readiness/cesped.mjs`):

```
24 PASA · 6 FALLA · 4 NO PROBADO

Fallos:
  ✗ horas de muy_descuidado coherentes con el 50 % configurado — serían 9 h, el motor da 10.5 h (hallazgo #1)
  ✗ horas de descuidado (1400 m²) coherentes con el 20 % configurado — serían 10.5 h, el motor da 11 h (hallazgo #1)
  ✗ 5000 m² normal → 30,0 h exactas — realidad 30.5 h (T2, coma flotante)
  ✗ plausibilidad · fotos 50000 m² sin ningún tope ni aviso (hallazgo #2)
  ✗ 1000 m² muy_descuidado (10,5h) — sin ningún hueco en 21 días (consecuencia del hallazgo #1)
  ✗ 1800 m² descuidado (~14,5h) sin ningún aviso de "no cabe en un día"
```

Las 3 NO PROBADO de 2A.4 (límites manuales) se deben a que `READINESS_ENGINE=local` invoca
`buildAuthoritativeBookingQuote` directamente, saltándose el gate de validación manual que
vive en `booking-authority/index.ts` — igual que la puerta de licencia fitosanitaria en otros
servicios. Se verificaron aparte con 3 llamadas HTTP puntuales contra el stack de referencia
(que en el momento de la prueba servía exactamente mi código, sin ninguna modificación de
producto todavía) y las tres dieron el 422 correcto. La cuarta NO PROBADO (2A.8, bloque de
hold huérfano) no encontró un `payment_attempt` libre en la base compartida por las otras 6
auditorías; ver acciones manuales.

## 6. Red de regresión

Runner: `scripts/readiness/cesped.mjs` (reescrito sobre el heredado de la tanda anterior: el
`serviceId` estaba obsoleto —la tabla `services` no fija ids en el seed— y varias
predicciones asumían "fixes" de una rama que nunca llegó a `origin/main`, en particular un
tope de 2000 m² en manual que en realidad es 5000, y avisos de plausibilidad que no existen
en el motor actual).

```bash
READINESS_ENGINE=local node scripts/readiness/cesped.mjs
```

Sale con código 1 mientras los hallazgos #1 y #2 sigan sin corregir (es la intención: el
runner documenta el estado real, no un estado deseado). Tras cualquier fix, relanzar y
comprobar que las FALLA correspondientes pasan a PASA sin que ninguna PASA se convierta en
FALLA.

## 7. Hallazgos transversales

Documentados en detalle en `docs/audit/COORDINACION-SERVICIOS.md` §3.2 (T2 actualizado, T3-T6
nuevos). **No se tocan en esta rama** — afectan a ficheros que no son de césped en solitario.

- **T2 — Redondeo de horas por coma flotante, ahora confirmado con una entrada real.** La
  ronda transversal (2026-09-09) lo había marcado como "no reproducido" tras barrer
  `totalHours` en decimal; ese método no lo encuentra porque el residuo depende de la cadena
  real de división/multiplicación, no del valor decimal final. Césped lo reprodujo dos veces
  (motor en proceso y HTTP) con `5000 m² ÷ 150 m²/h × 0,9`. `bookingQuoteCore.ts:1349-1350`.
- **T3 — El patrón del hallazgo #1 (multiplicador de horas fijo vs. recargo configurado)
  también existe en setos, desbroce y arbustos**, porque los cuatro bloques llaman a la misma
  `getDurationMultiplier` fija. El fix de césped (hallazgo #1 de este informe) se puede hacer
  dentro de mi bloque sin tocar la función compartida ni los otros bloques — pero quien
  audite setos/desbroce/arbustos debería saber que el mismo patrón les espera.
- **T4 — `respond_booking_price_change` no actualiza `duration_hours` al aceptar un cambio de
  precio.** Solo cambia `total_price`. Afecta a los 7 servicios: cualquier corrección de
  cantidad/superficie que cambie el precio también cambia las horas reales, y la RPC no se
  entera. Consecuencia medida en césped: el aviso de "¿se hizo el trabajo?" al cliente se
  habilita con la duración ANTIGUA, pudiendo pedir confirmación antes de que el trabajo
  corregido (más largo) haya podido terminar. `supabase/migrations/20260909121000_price_change_accept_uses_canonical_schedule.sql:112,117`.
- **T5 — Los botones de aceptar/rechazar cambio de precio no funcionan en el dashboard del
  cliente** (`src/components/client/ClientBookingLauncher.tsx:142-150`, faltan las dos claves
  en `cardHandlers`). Sí funcionan en `/bookings` (`BookingsList.tsx:303`). Afecta a los 7
  servicios por igual — el componente no depende del servicio.
- **T6 — Menor.** En el panel de solicitudes del jardinero, la cabecera de cada solicitud
  muestra `(1h)` fijo en vez de la duración real (`BookingRequestsManager.tsx:502`, usa
  `.length` de un array sintético de un elemento en vez de `duration_hours`). No afecta a
  precio ni a horas reales, solo a lo que lee el jardinero antes de aceptar. Afecta a los 7
  servicios.

## 8. Acciones manuales del usuario

- **`GOOGLE_API_KEY` no está configurada en el entorno local** (`supabase/functions/.env`).
  Sin ella no se puede probar el flujo de fotos de verdad (2B queda NO PROBADO). Añadirla y
  volver a ejecutar 2B antes de dar la paridad IA↔manual por cerrada al 100 %.
- **Turno de corrección.** Los hallazgos #1 y #2 de este informe son míos y puedo corregirlos
  en esta rama en cuanto lo autorices. Los hallazgos T2, T4, T5 y T6 (§7) son transversales:
  necesitan coordinarse con las otras seis auditorías antes de tocar
  `bookingQuoteCore.ts:1349-1350`, la RPC `respond_booking_price_change` o
  `ClientBookingLauncher.tsx` — decide cuándo entra la ronda transversal.
- **2A.8 (bloque de hold huérfano) quedó NO PROBADO.** La base de datos compartida por las
  siete auditorías no tenía ningún `payment_attempt` sin una `booking_schedule_hold`
  colgando ya. Para cerrarlo hace falta generar uno fresco con `create_quote` (requiere
  sesión) antes de montar la prueba sintética — dejo la consulta ya preparada en el propio
  runner (`scripts/readiness/cesped.mjs`, función `orphanHoldBlocks`).
- **Imágenes de servicios rotas** (placeholder gris en el paso "Servicios" del funnel) — ya
  documentado como pendiente en `produccion-8-items.md`, no es un hallazgo nuevo de esta
  auditoría, solo lo confirmo de paso.
- **Datos de prueba creados en la base de datos compartida** (`GarSer-referencia`), visibles
  para las otras seis auditorías: 2 reservas de césped (una completada con reseña 5★, otra
  cancelada) a nombre de `cliente.local@test.local` / `jardinero.local@test.local`. No tocan
  la configuración de ningún otro servicio; no debería hacer falta limpiarlos, pero aviso por
  si alguna otra auditoría cuenta filas de `bookings` o `reviews` y le extraña el número.
