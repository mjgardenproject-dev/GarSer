# Preparación para producción — Servicios fitosanitarios

**Veredicto: NO-GO**

El flujo manual —el único que un cliente puede completar hoy de principio a fin sin subir
fotos— cobra tarifas curativas por trabajos preventivos y no factura 25 de los ~30 precios
que el jardinero configura. Bloqueantes:

1. Un tratamiento **preventivo convencional se cobra a tarifa curativa** en césped, setos y
   árboles (+67 % en el caso base).
2. **«Plantas bajas» se factura con los precios de césped**; los 6 precios de plantas nunca
   se cobran por el camino manual.
3. **Palmeras ignora por completo `intent`**: preventivo y curativo cuestan lo mismo (+57 %).
4. **Árboles solo tiene dos bandas**: los precios de «grandes» no se facturan nunca a mano.
5. **Abrir el configurador sube los precios solo con mirarlo**: endoterapia 65 → 160 €/tronco.
6. Los ~30 precios que se cobran **no se ven ni se editan** en el panel del jardinero hasta
   pulsar un botón de método de cobro que parece no hacer nada.
7. **Un cliente nuevo no ve ningún profesional**: RLS deja `gardener_profiles` fuera de
   alcance para `anon` y para cualquier usuario sin reservas previas (afecta a los 7 servicios).
8. La **licencia fitosanitaria no filtra a nadie**, pese a que el panel se lo promete al
   jardinero y a que la ley lo exige para productos de uso profesional.

---

## 1. Hallazgos

| # | Severidad | Dimensión | Fase | Ubicación | Qué falla | Fix propuesto |
|---|---|---|---|---|---|---|
| 1 | Bloqueante | Precio | 2A | `src/shared/bookingQuoteCore.ts:729-767` | En el camino sin `analysisMetrics` (todo el flujo manual) `insecticida` y `fungicida` se mapean al precio **curativo** y solo `ecologico_preventivo` al preventivo. Un preventivo convencional paga tarifa curativa. Césped 1000 m²: 200 € en vez de 120 €. Setos bajos 100 ml: 180 € vs 120 €. Árboles pequeños 10 ud: 250 € vs 150 € | Que `calculatePhytosanitaryQuote` lea `detailed_pricing.<ámbito>.{preventivo,curativo}` según `intent`, en vez de pasar por las matrices legacy `superficies_plantas`/`setos`/`arboles` |
| 2 | Bloqueante | Precio | 2A | `src/shared/bookingQuoteCore.ts:731-742` y `:994` | `affectedType: 'Plantas bajas'` se factura con `detailed_pricing.cesped`. Los 6 precios de `detailed_pricing.plantas` (0,15–0,45 €/m²) no se cobran nunca por el camino manual, y `plantas.minimo: 45` tampoco | Rama propia para plantas con su tamaño dominante; añadir la pregunta de tamaño al wizard |
| 3 | Bloqueante | Precio | 2A | `src/shared/bookingQuoteCore.ts:975-982` | La rama de Palmeras no mira `intent`: solo `tradicional.hasta_3m`/`mas_de_3m`, derivados de `pequenas_curativo`/`medianas_curativo`. Preventivo = curativo. 5 palmeras medianas preventivo: 275 € en vez de 175 € | Precio por (tamaño × intención) desde `detailed_pricing.palmeras`, con tamaño declarado en el wizard |
| 4 | Bloqueante | Precio | 2A | `src/shared/bookingQuoteCore.ts:984-988` | Árboles solo tiene dos bandas (`hasta_3m`←pequeños, `mas_de_3m`←medianos). `grandes_preventivo` (40 €) y `grandes_curativo` (65 €) no se facturan nunca a mano: un árbol de 8 m se cobra como uno de 4 m | Tres bandas coherentes con el configurador (<3 m / 3-6 m / >6 m) y pregunta de tamaño en el wizard |
| 5 | Bloqueante | Config→cliente | 2C.a | `src/utils/phytosanitaryConfig.ts:236-300` | `toPersistedPhytosanitaryConfig` materializa bloques legacy con `Math.max(...)` al guardar. Abrir el configurador y elegir método de cobro **sube precios sin tocar ningún campo**: `endoterapia.precio_unico` 65 → 160 (= `altas_cirugia`), palmera >3 m 55 → 75, árbol >3 m 40 → 65 | Dejar de escribir los bloques legacy, o derivarlos sin `Math.max` y sin pisar `endoterapia.precio_unico`. Mientras el motor lea los legacy con prioridad, escribirlos mal es cambiar el precio |
| 6 | Bloqueante | Config→cliente | 2C.a | `src/components/gardener/PhytosanitaryPricingConfigurator.tsx:445` | «Tarifas por Categoría» solo se renderiza si `config.pricing_method === 'per_quantity'`. La config sembrada no trae esa clave y el motor asume `per_quantity`: los ~30 precios que se cobran son invisibles e ineditables hasta pulsar un botón aparentemente inerte | Tratar la ausencia de `pricing_method` como `per_quantity`, igual que hace `getPricingMethod` |
| 7 | Bloqueante | Filtrado | 2C.c | `src/pages/reserva/ProvidersPage.tsx:396-400` + RLS de `gardener_profiles` | `anon` no tiene SELECT (401) y las políticas de `authenticated` solo cubren perfil propio, admin y `shares_booking_with`. **Un cliente nuevo ve la lista vacía** aunque `booking-authority` lo declare elegible. Afecta a los 7 servicios | Vista o RPC pública con los campos no sensibles (nombre, avatar, media), o política de lectura para el catálogo |
| 8 | Bloqueante | Cumplimiento | papel · 2C.a | `src/pages/reserva/ProvidersPage.tsx:398`, `supabase/functions/booking-authority/index.ts` | `has_phytosanitary_license` se selecciona pero **no filtra en ningún sitio**, y la autoridad no menciona la licencia. El panel promete al jardinero que sin carnet solo saldrá en búsquedas ecológicas | Puerta en `booking-authority`: si alguna zona tiene `productPreference !== 'ecological'`, excluir al proveedor sin licencia verificada con su código de exclusión |
| 9 | Grave | Paridad | 2A | `src/shared/bookingQuoteCore.ts:896-950` | El camino de métricas retorna antes del filtro `tratamientos_activos`. Con `["insecticida"]`: fungicida a mano → 422; fungicida por fotos → 260 € reservables. Ídem endoterapia | Aplicar el filtro antes de calcular, en los dos caminos |
| 10 | Grave | Paridad | papel · 2C.b | `src/shared/manualEntry/manualEntrySchema.ts:621-687` | El wizard manual no pregunta tamaño de planta/árbol/palmera (solo un sí/no «>2-3 m»), ni ofrece endoterapia ni «todo el jardín», que el flujo de fotos sí produce | Añadir tamaño por ámbito y endoterapia para palmeras |
| 11 | Grave | Precio | 2A · 2C.b | `src/shared/bookingQuoteCore.ts:819` | `wasteMult = 1` fijo. El interruptor «Retirada de restos» del wizard no mueve precio ni horas: 200 € / 2,5 h con y sin | O se cobra y se suma a las horas, o se retira del wizard para este servicio |
| 12 | Grave | Precio | 2A | `src/shared/bookingQuoteCore.ts:1038-1040` | Los mínimos por ámbito (`cesped/setos/arboles` 50, `plantas` 45, `palmeras` 60) no se leen nunca; se aplica el global 50. Plantas 20 m² → 50 € (debería 45); palmera suelta → 50 € (debería 60) | Aplicar el mínimo del ámbito por zona y el global al total |
| 13 | Grave | Coherencia | 2A · 2C.d | `src/shared/bookingQuoteCore.ts:390` y `:1495-1498` | Cada línea del desglose se redondea con `Math.ceil` a euro entero; el total con `ceil(round(x,2))`. Curativo eco 1000 m²: desglose **221 €**, cobro **220 €** | Redondear una sola vez, en el total, y repartir el desglose sobre el importe ya redondeado |
| 14 | Grave | Coherencia | papel · 2A | configurador vs. `manualEntrySchema.ts:673-686` vs. motor | Tres juegos de bandas distintos: setos «<2,5 m / 2,5-5 m» vs `hasta_2m/mas_de_2m` vs «¿supera 2-3 m?»; palmeras «<3,5 / 3,5-8 / >8» vs un único corte de 3 m; árboles «<3 / 3-6 / >6» vs un corte de 3 m | Una SSOT de bandas por ámbito, como `hedgeBusinessRules.ts` en setos |
| 15 | Grave | Filtrado | 2C.c | `src/pages/reserva/ProvidersPage.tsx:447-449` | Con `requiresChemical` el mensaje de lista vacía siempre dice «requiere licencia fitosanitaria», tapando la causa real (fuera de cobertura, sin huecos, sin coordenadas) | Priorizar el código de exclusión real y dejar el mensaje de licencia solo cuando la exclusión sea esa |
| 16 | Menor | Config | 2C.a | `PhytosanitaryPricingConfigurator.tsx` | Claves sembradas y **facturadas** sin control en la UI: `combo.three_plus_treatments_percentage` (25 %), `palmeras.endoterapia.precio_unico` (65 €), `tratamientos_activos`. Y `detailed_pricing.*.minimo` no tiene ni UI ni motor | Añadir los controles que faltan; borrar lo que no se factura |
| 17 | Menor | Precio | papel | `bookingQuoteCore.ts:722`, `:1038`, `:1375` | Mínimo triplicado (`importe_minimo`/`minimum_price`/`minimum_fee`) y aplicado dos veces: dentro del presupuesto fitosanitario y otra vez en `applyMinimumPrice` | Una sola clave, un solo punto de aplicación |
| 18 | Menor | Precio | papel | `bookingQuoteCore.ts:731-742` | `superficies_plantas.hasta_100m2` y `mas_de_100m2` derivan del mismo precio: la banda de >100 m² no existe en la práctica | Se resuelve solo al arreglar el hallazgo 1 |
| 19 | Menor | Vida real | 2A | — | No hay aviso de plausibilidad en ningún punto del rango: 5000 m² de césped a tratar salen 1000 € sin un solo `warning`. Césped, setos y palmeras sí avisan en sus servicios | Aviso por encima de un umbral por ámbito |
| 20 | Menor | Precio | papel · 2A | `bookingQuoteCore.ts:918-921` | `herbicida_poca_densidad_m2` y `herbicida_mucha_densidad_m2` están en el contrato de extracción de la IA pero no tienen tarifa: si la IA los rellena, subtotal 0 → 422 `recalculation_ineligible` y la reserva muere sin explicación útil | Tarifa de herbicida en el configurador, o retirar esas métricas del esquema |
| 21 | Menor | Fixture | 2A | `supabase/seed.sql` | La configuración del jardinero sembrado **no está en el repo**: ni en `seed.sql` ni en ninguna migración. Vive solo en la BD local y un `supabase db reset` la borra | Se ha dejado copia en `scripts/readiness/fixtures/fitosanitarios.config.json` con `restore-fixture.sh`; conviene llevarla al seed |

---

## 2. Papel vs. realidad

Predicciones de Fase 1 hechas **leyendo el motor** (qué va a hacer), contrastadas con la
ejecución. Coinciden en los 14 casos: la lectura del código fue correcta y el problema no es
un despiste de implementación, es el diseño de la ruta sin métricas.

| Escenario (declarado a mano) | Predicción Fase 1 | Devuelto por el motor | Desviación |
|---|---|---|---|
| Césped 1000 m² preventivo convencional | 200,00 € · 2,5 h | 200,00 € · 2,5 h | — |
| Césped 1000 m² curativo insectos | 200,00 € · 2,5 h | 200,00 € · 2,5 h | — |
| Césped 1000 m² curativo ambos | 460,00 € · 2,5 h | 460,00 € · 2,5 h | — |
| Césped 1000 m² preventivo ecológico | 132,00 € · 2,5 h | 132,00 € · 2,5 h | — |
| Césped 100 m² (mínimo) | 50,00 € · 1 h | 50,00 € · 1 h | — |
| Setos 100 ml >2 m curativo ambos | 598,00 € · 2 h | 598,00 € · 2 h | — |
| Setos 100 ml <2 m preventivo | 180,00 € · 2 h | 180,00 € · 2 h | — |
| Árboles 10 ud >3 m curativo | 400,00 € · 2 h | 400,00 € · 2 h | — |
| Árboles 10 ud <3 m preventivo | 250,00 € · 2 h | 250,00 € · 2 h | — |
| Palmeras 5 ud >3 m preventivo | 275,00 € · 1,5 h | 275,00 € · 1,5 h | — |
| Palmeras 5 ud >3 m curativo | 275,00 € · 1,5 h | 275,00 € · 1,5 h | — |
| Plantas bajas 200 m² curativo | 50,00 € · 1 h | 50,00 € · 1 h | — |
| Césped 5000 m² preventivo | 1000,00 € · 11,5 h | 1000,00 € · 11,5 h | — |
| Palmeras 5 ud ins+fung+endoterapia | 1094,00 € · 1,5 h | 1094,00 € · 1,5 h | — |

**Y ahora lo que importa.** Esas mismas cifras contra lo que dice la **configuración del
jardinero** —que es lo que el runner exige, porque es lo que el jardinero cree que cobra:

| Escenario | Según la configuración | Cobrado | Desviación |
|---|---|---|---|
| Césped 1000 m² preventivo | 120,00 € | 200,00 € | **+66,7 %** |
| Setos 100 ml bajos preventivo | 120,00 € | 180,00 € | **+50,0 %** |
| Árboles 10 ud pequeños preventivo | 150,00 € | 250,00 € | **+66,7 %** |
| Árboles 10 ud grandes curativo | 650,00 € | 250,00 € | **−61,5 %** |
| Palmeras 5 ud medianas preventivo | 175,00 € | 275,00 € | **+57,1 %** |
| Palmeras 5 ud altas curativo | 375,00 € | 200,00 € | **−46,7 %** |
| Plantas bajas 500 m² grandes curativo | 225,00 € | 100,00 € | **−55,6 %** |
| Plantas bajas 20 m² (mínimo del ámbito) | 45,00 € | 50,00 € | +11,1 % |
| Palmeras 1 ud (mínimo del ámbito) | 60,00 € | 50,00 € | −16,7 % |

Se cobra de más en lo pequeño y de menos en lo grande. Las dos direcciones son un problema:
la primera es sobrecoste al cliente, la segunda es trabajo que el jardinero hace por debajo
de su tarifa.

---

## 3. Barrido de variables

Las 28 entradas de `detailed_pricing` más los modificadores y los mínimos. Base holgada,
lejos del mínimo. «Alcanzable» = el flujo del cliente puede producir ese precio.

| Clave de `additional_config` | Esperado | Observado | Veredicto |
|---|---|---|---|
| `cesped.preventivo` (1000 × 0,12) | 120,00 € | 200,00 € | **FALLA** — se cobra `curativo` |
| `cesped.curativo` (1000 × 0,20) | 200,00 € | 200,00 € | PASA |
| `setos.bajos_preventivo` (100 × 1,2) | 120,00 € | 180,00 € | **FALLA** |
| `setos.bajos_curativo` (100 × 1,8) | 180,00 € | 180,00 € | PASA |
| `setos.altos_preventivo` (100 × 1,8) | 180,00 € | 260,00 € | **FALLA** |
| `setos.altos_curativo` (100 × 2,6) | 260,00 € | 260,00 € | PASA |
| `arboles.pequenos_preventivo` (10 × 15) | 150,00 € | 250,00 € | **FALLA** |
| `arboles.pequenos_curativo` (10 × 25) | 250,00 € | 250,00 € | PASA |
| `arboles.medianos_preventivo` (10 × 25) | 250,00 € | 250,00 € | PASA por coincidencia numérica |
| `arboles.medianos_curativo` (10 × 40) | 400,00 € | 250,00 € | **FALLA** — el wizard no distingue banda |
| `arboles.grandes_preventivo` (10 × 40) | 400,00 € | 250,00 € | **FALLA** — inalcanzable a mano |
| `arboles.grandes_curativo` (10 × 65) | 650,00 € | 250,00 € | **FALLA** — inalcanzable a mano |
| `plantas.pequenas_preventivo` (500 × 0,15) | 75,00 € | 100,00 € | **FALLA** — cobra césped |
| `plantas.pequenas_curativo` (500 × 0,25) | 125,00 € | 100,00 € | **FALLA** |
| `plantas.medianas_preventivo` (500 × 0,20) | 100,00 € | 100,00 € | PASA por coincidencia numérica |
| `plantas.medianas_curativo` (500 × 0,32) | 160,00 € | 100,00 € | **FALLA** |
| `plantas.grandes_preventivo` (500 × 0,28) | 140,00 € | 100,00 € | **FALLA** |
| `plantas.grandes_curativo` (500 × 0,45) | 225,00 € | 100,00 € | **FALLA** |
| `palmeras.pequenas_preventivo` (5 × 25) | 125,00 € | 200,00 € | **FALLA** |
| `palmeras.pequenas_curativo` (5 × 40) | 200,00 € | 200,00 € | PASA |
| `palmeras.medianas_preventivo` (5 × 35) | 175,00 € | 200,00 € | **FALLA** |
| `palmeras.medianas_curativo` (5 × 55) | 275,00 € | 200,00 € | **FALLA** |
| `palmeras.altas_preventivo` (5 × 50) | 250,00 € | 200,00 € | **FALLA** |
| `palmeras.altas_curativo` (5 × 75) | 375,00 € | 200,00 € | **FALLA** |
| `palmeras.pequenas_cirugia` (2 × 90) | 180,00 € | 368,00 € | **FALLA** — siempre cobra la cirugía más cara |
| `palmeras.medianas_cirugia` (2 × 120) | 240,00 € | 368,00 € | **FALLA** — ídem |
| `palmeras.altas_cirugia` (2 × 160) | 320,00 € | 368,00 € | **FALLA** — 320 correcto + 15 % de combo fantasma |
| `palmeras.endoterapia.precio_unico` (5 × 65) | 325,00 € | 325,00 € | PASA (solo por fotos) |
| `pricing_modifiers.eco` (+10 %) | 220,00 € | 220,00 € | PASA |
| `pricing_modifiers.combo.two` (+15 %) | 460,00 € | 460,00 € | PASA |
| `pricing_modifiers.combo.three_plus` (+25 %) | 1094,00 € | 1094,00 € | PASA |
| `cesped.minimo` (50) | 50,00 € | 50,00 € | PASA (coincide con el global) |
| `setos.minimo` (50) | 50,00 € | 50,00 € | PASA (coincide con el global) |
| `arboles.minimo` (50) | 50,00 € | 50,00 € | PASA (coincide con el global) |
| `plantas.minimo` (45) | 45,00 € | 50,00 € | **FALLA** — se ignora |
| `palmeras.minimo` (60) | 60,00 € | 50,00 € | **FALLA** — se ignora |
| `waste_removal` (interruptor del wizard) | mueve precio u horas | 200 € / 2,5 h en ambos | **FALLA** — sin efecto |
| `yields.*` (6 rendimientos) | horas de cada ámbito | correctas en los 6 | PASA |

**19 de 37 claves fallan.** Los tres mínimos que pasan lo hacen por coincidir con el global,
no porque se lean.

---

## 4. Matriz de paridad

| Variable | Config jardinero | Flujo IA | Flujo manual | Motor | Veredicto |
|---|---|---|---|---|---|
| Ámbito tratado | ✓ | ✓ | ✓ | ✓ | OK |
| Cantidad (m²/ml/ud) | — | ✓ | ✓ | ✓ | OK |
| Preventivo / curativo | ✓ | ✓ | ✓ | solo IA | **El manual paga siempre curativo** |
| Objetivo curativo (insectos/hongos/ambos) | ✓ | ✓ | ✓ | ✓ | OK |
| Producto ecológico | ✓ | ✓ | ✓ | ✓ | OK |
| Tamaño de planta | ✓ (3 bandas) | ✓ | ✗ | solo IA | Solo IA |
| Tamaño de árbol | ✓ (3 bandas) | ✓ | ✗ (sí/no >3 m) | 2 bandas | **Las tres divergen** |
| Tamaño de palmera | ✓ (3 bandas) | ✓ | ✗ (sí/no >3 m) | 2 bandas, sin intención | **Las tres divergen** |
| Altura de seto | ✓ (2 bandas «2,5 m») | ✓ | ✓ («2-3 m») | 2 bandas («2 m») | Umbrales distintos |
| Cirugía de palmera | ✓ (3 precios) | ✓ (1 conteo) | ✗ | siempre el más caro | **Solo IA y mal tarifado** |
| Endoterapia | ✗ sin UI | ✓ | ✗ | ✓ | Solo IA |
| Herbicida | ✗ sin tarifa | ✓ (2 métricas) | ✗ | ✗ → 422 | **Roto** |
| Modificador eco | ✓ | ✓ | ✓ | ✓ | OK |
| Combo 2 tratamientos | ✓ | ✓ | ✓ | ✓ | OK |
| Combo 3+ tratamientos | ✗ sin UI | ✓ | ✗ | ✓ | Solo IA |
| Tratamientos activos | ✗ sin UI | ignora el filtro | ✓ | asimétrico | **Solo filtra en manual** |
| Mínimo por ámbito | ✗ sin UI | ✗ | ✗ | ✗ | Muerto |
| Retirada de restos | ✗ sin config | ✗ | ✓ (interruptor) | ignorado | **Interruptor decorativo** |

Ejecución de la paridad, mismo jardín físico por los dos caminos:

| Caso | Manual | Fotos | Diferencia |
|---|---|---|---|
| Césped 1000 m² preventivo | 200 € / 2,5 h | 120 € / 2,5 h | **+67 % a mano** |
| Césped 1000 m² curativo insectos | 200 € / 2,5 h | 200 € / 2,5 h | — |
| Setos 100 ml altos curativo | 260 € / 2 h | 260 € / 2 h | — |
| Árboles 3 ud grandes curativo | 120 € / 1 h | 195 € / 1 h | **−38 % a mano** |
| Palmeras 4 ud altas preventivo | 220 € / 1 h | 200 € / 1 h | +10 % a mano |
| Plantas bajas 200 m² medianas curativo | 50 € / 1 h | 64 € / 1 h | **−22 % a mano** |

---

## 5. Guion de Fase 2

| Paso | Resultado | Evidencia |
|---|---|---|
| 2A.1 escenarios (10) | 5 PASA · 5 FALLA | `E1 … precio esperado 120.00 €, obtenido 200.00 €` |
| 2A.2 paridad IA↔manual (6) | 2 PASA · 4 FALLA | `manual 200 € / 2.5 h · IA 120 € / 2.5 h` |
| 2A.3 barrido `detailed_pricing` (28) | 11 PASA · 17 FALLA | tabla §3 |
| 2A.4 modificadores eco y combo (4) | PASA | `220 €`, `460 €`, `1094 €`, `130 €` |
| 2A.5 mínimos por ámbito (5) | 3 PASA · 2 FALLA | `mínimo plantas bajas 20 m² → 45 € — obtenido 50.00 €` |
| 2A.6 desglose = total (2) | 1 PASA · 1 FALLA | `desglose 221 € ≠ total 220 €` |
| 2A.6bis retirada de restos | FALLA | `idéntico con y sin: 200 € / 2.5 h` |
| 2A.6bis `tratamientos_activos` en ambos caminos | FALLA (probado aparte) | con `["insecticida"]`: manual fungicida `422 recalculation_ineligible`; fotos fungicida `200 €260` |
| 2A.7 límites manuales | PASA | 6000 m² → `422 manual_input_invalid`; 0 → `422` |
| 2A.7 aviso de plausibilidad | FALLA | 5000 m² → `1000 €`, `warnings: []` |
| 2A.8 domingo sin huecos | PASA | `validHours=[] (200)` para 2026-09-13 |
| 2A.8 martes con huecos | PASA | `validHours=[8,9,10,11,12,13,14,15]` |
| 2A.8 dentro de cobertura | PASA | `eligibleProviderIds=["11111111-…"]` |
| 2A.8 fuera de cobertura | PASA | `{"code":"outside_coverage",…}` |
| 2B análisis real con Gemini | **NO PROBADO** | `"error_code":"PROVIDER_AUTH_MISSING"` — sin `GOOGLE_API_KEY` local, y el repo no trae fotos de plaga de muestra |
| 2B contrato de métricas → motor | PASA | las 6 parejas de §4 usan payloads con la forma exacta de `adaptPhytosanitaryAnalysisResult` |
| 2C.a configurador vs. BD | FALLA | tarifas ocultas sin `pricing_method`; guardado sube endoterapia 65 → 160 |
| 2C.b wizard manual completo | PASA (cableado) / FALLA (importe) | pantalla: `225,00 €`, `2.5 h`, desglose `Zona 1: Césped · 1000m2 · insecticida — 200,00 €` para un preventivo declarado |
| 2C.c listado de jardineros (cliente nuevo) | FALLA | `GET /rest/v1/gardener_profiles → 401`; SQL: 0 filas para un usuario sin reservas |
| 2C.c listado (cliente con reservas) | PASA | Miguel Ángel Ruiz, 225,00 €, 3.3 (6) |
| 2C.d reserva hasta pago | PASA | «Subtotal 200,00 € · Tarifa de reserva 25,00 € · Pagas ahora 25,00 € · Pendiente 200,00 €» |
| 2C.d persistencia del presupuesto | PASA | `booking_quotes`: `200 \| 2.5 \| active \| 2026-09-15 \| 09:00:00`, `economic_snapshot` idéntico al del motor, `input_payload` conserva `intent: "preventive"` |
| 2C.d pago con tarjeta | **NO PROBADO** | `PaymentElement` de Stripe en iframe de otro origen |
| 2C.e cambio de precio (motor) | PASA | `recalculate_correction` recalcula con las variables corregidas |
| 2C.e cambio de precio (UI jardinero→cliente) | **NO PROBADO** | requiere una reserva pagada; el pago queda fuera de alcance |
| 2C.f cancelación y movimiento de dinero | **NO PROBADO** | ídem |
| 2C.g finalización y reseña | **NO PROBADO** | ídem |
| 2C.h volver a reservar | **NO PROBADO** | ídem |
| 2C.i consola y red | FALLA | dos `401 Unauthorized` en `gardener_profiles` (hallazgo 7); ningún otro error |
| — subida de fotos por la UI | **NO PROBADO** | el panel Browser no puede rellenar `<input type=file>` |

---

## 6. Red de regresión

```bash
node scripts/readiness/fitosanitarios.mjs
```

Desde un git worktree hay que decirle dónde se levantó el stack:

```bash
SUPABASE_PROJECT_DIR="/Users/javier/Downloads/GarSer-main 4" node scripts/readiness/fitosanitarios.mjs
```

Estado actual: **31 PASA · 34 FALLA · 0 NO PROBADO**, salida con código 1.

Los valores esperados se derivan de la **configuración del jardinero**, no del comportamiento
actual del motor: el runner debe seguir fallando mientras el motor no cobre lo que el
jardinero configuró, y pasar entero cuando lo haga.

El configurador reescribe `additional_config` al abrirse, así que después de cualquier paso
de navegador hay que devolver el fixture a su sitio antes de volver a medir:

```bash
./scripts/readiness/restore-fixture.sh fitosanitarios
```

---

## 7. Acciones manuales del usuario

**Nada que desplegar todavía** — no se ha tocado ni una línea de código de producción. Esta
auditoría se ha parado en el informe, a la espera de tu decisión sobre qué corregir.

Lo que sí queda de tu mano ahora mismo:

1. **Decidir el alcance de la Fase 3.** Los 8 bloqueantes son de tres familias distintas
   (motor de precios, configurador, RLS/licencia) y se pueden abordar por separado.
2. **`GOOGLE_API_KEY` en local** (`supabase/functions/.env`) y **2-3 fotos de plaga reales**
   para poder cerrar 2B. Sin eso, el análisis con Gemini se queda en NO PROBADO: no lo he
   simulado a propósito, porque una paridad verificada contra datos inventados parece una
   garantía y no lo es.
3. **Pago con tarjeta de test** (`4242 4242 4242 4242`) en `ConfirmationPage` para desbloquear
   el ciclo de vida completo (2C.e a 2C.h). El `PaymentIntent` y el importe sí están
   verificados hasta donde llega el backend.
4. **Subida de fotos por la UI**: recorte, compresión, límite de tamaño y estados de error
   siguen sin probar.
5. **Llevar el fixture al seed.** La configuración del jardinero sembrado no está en el repo;
   he dejado copia en `scripts/readiness/fixtures/fitosanitarios.config.json`, pero un
   `supabase db reset` seguirá borrando la de la base de datos hasta que entre en `seed.sql`.
6. **`docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md` vive en la rama `fix/pagos-emails-geocoding`**,
   no en `main`. La traducción a producción de estas pruebas se añadirá allí cuando estén los
   fixes, para no escribir una batería sobre código que va a cambiar.

### Nota sobre el entorno

El stack de Supabase que responde en `127.0.0.1:54321` se levantó desde el checkout principal
(`fix/pagos-emails-geocoding`), no desde este worktree. He verificado que el bloque
fitosanitario de `bookingQuoteCore.ts` es **idéntico** byte a byte en ambos, así que las
mediciones valen para el código auditado. Al aplicar fixes habrá que replicarlos en el
checkout principal, o relanzar el stack desde este worktree, antes de reejecutar el runner.
