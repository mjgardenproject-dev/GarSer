# Servicios fitosanitarios — preparación para producción

**Fecha:** 2026-09-12 · **Rama:** `auditoria/fitosanitarios` (sale de `origin/main`, 0 commits por detrás)
**serviceId real:** `fc96088a-81f8-4efc-8908-b28a401ea556`
**Jardinero sembrado:** Miguel Ángel Ruiz `11111111-aaaa-4aaa-8aaa-111111111111`

## Veredicto: **NO-GO**

Tres bloqueantes, todos de caja y todos reproducidos dos veces —con el motor en proceso y
navegando la web en el servidor local de este worktree—. El más grave no es que el precio
sea discutible, sino que **el mismo trabajo cuesta dos cosas distintas según por dónde entre
el cliente**, y la diferencia llega a ser exactamente el doble.

El ciclo de pago, en cambio, funciona de principio a fin y con el dinero en su sitio: eso sí
quedó verificado contra Stripe.

---

## 1 · Hallazgos

### Bloqueantes

#### #1 · El camino manual factura los tratamientos preventivos a tarifa curativa

`src/shared/bookingQuoteCore.ts:727-770` (`normalizePhytosanitaryPricingConfig`)

Las estructuras que usa el camino sin métricas derivan `insecticida` y `fungicida` **siempre**
del precio `*_curativo`, sin mirar el `intent`:

```ts
setos: {
  hasta_2m: {
    insecticida: Number(raw?.setos?.hasta_2m?.insecticida || detailed.setos.bajos_curativo || 0),
    fungicida:   Number(raw?.setos?.hasta_2m?.fungicida   || detailed.setos.bajos_curativo || 0),
    ecologico_preventivo: Number(… || detailed.setos.bajos_preventivo || 0),
  },
```

Un tratamiento preventivo pide `insecticida` (`:864`, rama `else`), así que cobra el precio
curativo. La tarifa preventiva configurada solo se alcanza si el cliente elige producto
**ecológico**. El builder manual (`src/pages/reserva/manualEntryBuilders.ts:288-310`) nunca
produce `analysisMetrics`, de modo que **todo el flujo manual va por este camino**.

Medido (motor en proceso y pantalla del cliente, coinciden al céntimo):

| Caso (manual) | Configurado | Cobrado | Desvío |
|---|---|---|---|
| Césped 1000 m² preventivo | 1000 × 0,12 = **120 €** | **200 €** | +66,7 % |
| Setos 200 ml preventivo ≤2 m | 200 × 1,20 = **240 €** | **360 €** | +50 % |
| Árboles 5 ud preventivo ≤3 m | 5 × 15 = **75 €** | **125 €** | +66,7 % |
| Palmeras 4 ud preventivo ≤3 m | 4 × 25 = **100 €** | **160 €** | +60 % |
| Plantas 2000 m² preventivo | 2000 × 0,15 = **300 €** | **400 €** | +33,3 % |

Dos consecuencias visibles para el cliente, las dos comprobadas en pantalla:

- **La pregunta «¿preventivo o curativo?» no cambia el precio** en césped ni en plantas.
  Caso 9 y caso 10 navegados: 2000 m² de plantas dan **400,00 € / 7 h** tanto en preventivo
  como en curativo.
- **El producto ecológico sale más barato que el convencional**: césped 1000 m² preventivo
  ecológico = **132 €**, convencional = **200 €** — un 34 % menos, mientras la propia
  pantalla avisa de que el ecológico «puede tener recargo».

#### #2 · Doble cobro del curativo «insectos y hongos» en el camino manual

`src/shared/bookingQuoteCore.ts:975-1018`

Cuando `curativeTarget === 'both'`, `unitPrice` **suma dos veces la misma tarifa curativa**
(una por `insecticida`, otra por `fungicida`, que valen lo mismo tras la derivación de #1) y
encima aplica el recargo de combo del 15 %. El camino de fotos, para el mismo input físico,
cobra la tarifa una sola vez y le aplica el combo.

```
Césped 1000 m² curativo insectos+hongos
  manual : (0,20 + 0,20) × 1000 × 1,15 = 460,00 €   ← navegado, pantalla del cliente
  fotos  :  0,20 × 1000 × 1,15         = 230,00 €
```

Exactamente el doble. En palmeras, 4 ud curativo ambos: **368 €** manual frente a 184 € por
fotos.

#### #3 · Un tratamiento de plantas reservado por fotos bloquea 1 hora en vez de 6,67

`src/shared/bookingQuoteCore.ts:1383-1400`

El bloque de horas del flujo de fotos enumera once métricas y **omite
`plantas_superficie_calculada_m2`**. El propio motor se contradice: la barrera de
elegibilidad sí la exige.

```ts
// :536  — la elegibilidad reclama el rendimiento…
if (metrics.plantas_superficie_calculada_m2) required.add('plantas_m2_per_hour');

// :1383-1400 — …y el cálculo de horas nunca lo usa: no hay línea para esa métrica.
if (metrics.cesped_m2) totalHours += metrics.cesped_m2 / Number(yields.cesped_m2_per_hour || 0);
…
if (metrics.arboles_gran_ud) totalHours += metrics.arboles_gran_ud / Number(yields.arboles_units_per_hour || 0);
```

Medido: 2000 m² de plantas por fotos = **300 € / 1 h** (el mínimo de 1 h), cuando el
rendimiento configurado (300 m²/h) da 6,67 h. Por el camino manual el mismo trabajo reserva
**7 h**. El jardinero recibe un encargo de casi una jornada con una hora de agenda
bloqueada.

### Graves

#### #4 · «Plantas bajas» se factura con la tarifa de césped en el camino manual

`src/shared/bookingQuoteCore.ts:995` — la rama final usa `normalized.superficies_plantas`,
que `:726-738` deriva de `detailed.cesped`, no de `detailed.plantas`. Las seis tarifas de
`detailed_pricing.plantas` son **inalcanzables desde el wizard manual**; solo las alcanza el
flujo de fotos.

#### #5 · El configurador no expone ninguna de las 25+ tarifas del servicio

Verificado en vivo. El panel «Configurar Servicios fitosanitarios» contiene **nueve campos y
ningún otro**: precio mínimo (50), los seis rendimientos, y los dos suplementos (eco 10 %,
combo 15 %). Volcado literal de los `input` del panel:

```
50 · 400 · 60 · 300 · 5 · 4 · 3 · 10 · 15
```

No hay control —ni colapsado: `[aria-expanded]` devuelve 0— para `detailed_pricing`
(25 precios), `palmeras.endoterapia.precio_unico`, los cinco `minimo` por ámbito, ni
`combo.three_plus_treatments_percentage`. La pantalla afirma «El precio se calculará usando
tus tarifas fijas por categoría» y esas tarifas no se pueden ver ni editar.

Consecuencia: un jardinero que se dé de alta hoy tendría `detailed_pricing` vacío, el motor
devolvería `Tarifa base no configurada` y no podría vender el servicio. El jardinero sembrado
solo funciona porque el seed le escribió las tarifas directamente en la base de datos.

#### #6 · La cirugía de palmeras arrastra un recargo de combo por un tratamiento que no se factura

`src/shared/bookingQuoteCore.ts:868-871` añade `endoterapia` a `requestedTreatments` en cuanto
hay `palmeras_cirugia_ud`, y `:930-933` cuenta esa lista para decidir el combo. Pero el
subtotal detallado solo factura la cirugía, sin ducha. Resultado: 4 cirugías se cobran
**736 €** en vez de los 640 € configurados (160 × 4), un +15 % por un segundo tratamiento
inexistente. Es el único fallo que el barrido de tarifas del runner detectó por sí solo.

#### #7 · El interruptor de altura hereda el valor de la zona anterior

Reproducido navegando: tras una zona con «Supera los 2-3 m» activado, al abrir una **zona
nueva** el interruptor llega ya en `true` sin que el cliente lo toque
(`TOGGLE_AL_ENTRAR=true`). En el caso 7 navegado eso convirtió unas palmeras que pedí ≤3 m en
«Supera los 2-3 m: Sí», cobrando 220 € (4 × 55) en vez de 160 € (4 × 40). Sobre palmeras son
15 €/ud; sobre setos, 0,80 €/ml.

### Moderados

| # | Qué pasa | Dónde |
|---|---|---|
| #8 | **Tarifas que ningún camino manual puede alcanzar**: `arboles.grandes_*` (un árbol de 8 m se cobra como mediano), `palmeras.altas_*`, los tamaños mediano/grande de plantas, y la **endoterapia** entera —está en `tratamientos_activos` con precio de 65 €/tronco y el wizard no la ofrece—. | `bookingQuoteCore.ts:751-770`; encuesta en `manualEntrySchema.ts:630-697` |
| #9 | **Los cinco `minimo` por ámbito son claves muertas.** `normalizePhytosanitaryPricingConfig` no los lee. Medido: palmeras 1 ud factura 50 € (mínimo global) en vez de los 60 € de `palmeras.minimo`; plantas 100 m², 50 € en vez de 45 €. | `bookingQuoteCore.ts:715-718` |
| #10 | **La retirada de restos es inerte.** `const wasteMult = 1` está fijo, y `globalWaste` se recibe y se ignora. Pero el wizard **sí la pregunta** (pantalla «Retirada de restos» navegada), el resumen del cliente dice «Retirada de restos: Sí» y la solicitud del jardinero muestra «Retirada de restos incluida». Delta medido con `true` vs `false`: 0 € y 0 h. | `bookingQuoteCore.ts:813` |
| #11 | **Mínimo triplicado con dos resoluciones distintas.** `importe_minimo`/`minimum_price`/`minimum_fee` valen 50 los tres. El bloque fitosanitario resuelve `minimum_fee ?? importe_minimo ?? minimum_price` (`:717`); `applyMinimumPrice` resuelve `minimum_price \|\| minimumPrice \|\| importe_minimo` (`:1424`). Hoy coinciden; el día que difieran, cobrarán distinto. | `bookingQuoteCore.ts:717` y `:1424` |
| #12 | **La banda `mas_de_100m2` es idéntica a `hasta_100m2`**: las dos derivan de los mismos dos precios de césped, así que el tramo de superficie nunca mueve el precio. Delta 0 garantizado por construcción. | `bookingQuoteCore.ts:722-738` |
| #13 | **El motor no valida rangos.** Acepta 6000 m² (máximo declarado 5000) y devuelve 1200 € / 13,5 h sin error ni aviso de plausibilidad, a diferencia de césped, setos y palmeras, que ya tienen su `*_implausible`. **El wizard manual sí lo bloquea** («Cantidad a tratar no puede superar 5000», navegado), así que no es explotable desde la UI: es defensa en profundidad ausente. | `bookingQuoteCore.ts:1381-1402` (sin `pushWarning`) |

### Lo que está bien y conviene no tocar

- **El ciclo de pago, entero y con el dinero donde debe.** Reserva `96c36b15-040f-4062-af42-781faba3e8be`
  creada con pago real: `pending` + PaymentIntent `pi_3UEe6X2MwFyGXuB70QvnARa8` en
  `requires_capture` (750 cts autorizados, `amount_received: 0`); tras aceptar el jardinero,
  `confirmed` y el PaymentIntent en **`succeeded`, `amount_capturable: 0`, `amount_received: 750`**.
  La captura diferida funciona como se diseñó.
- **La UI está fielmente cableada al motor autoritativo.** En los 14 casos, el precio y las
  horas de pantalla coincidieron al céntimo con `buildAuthoritativeBookingQuote`. Los fallos
  son del cálculo, no del cableado.
- **El autoguardado del primer render NO ocurre en este configurador.** Era la pregunta que
  setos y palmeras dejaron abierta para los otros cinco. Abierto el panel y esperado, el
  `additional_config` quedó intacto: mismo `md5 = 46bfc95e68d72ce08c6e240ec18eb49a`, misma
  longitud 1406, `updated_at` sin moverse del 2026-09-06. **Fitosanitarios queda descartado.**
- **Disponibilidad.** Los domingos (13, 20, 27) salen deshabilitados en el calendario, y las
  horas ofrecidas respetan la duración: 2,5 h → 11:00-15:00; 7 h → solo 11:00.
- El desglose cliente/jardinero es correcto: 67,50 € = 60,00 € al profesional + 7,50 € de
  gestión (12,5 %), y así queda en `bookings` (`total_price 60.00`, `management_fee 7.50`).

---

## 2 · Tabla de predicciones (Fase 1) y su contraste

Calculada a mano contra el `additional_config` leído por SQL. **Las doce predicciones
coincidieron con el motor al céntimo**, lo que confirma que los desvíos de arriba son del
diseño del cálculo y no de una lectura equivocada.

| # | Entrada (manual) | Predicción a mano | Motor | UI |
|---|---|---|---|---|
| 1 | Césped 200 m² preventivo | 50 € (mínimo) / 1 h | 50 € / 1 h | — |
| 2 | Césped 1000 m² preventivo | 200 € / 2,5 h | 200 € / 2,5 h | **200 € / 2,5 h** |
| 3 | Césped 1000 m² curativo ambos | 460 € / 2,5 h | 460 € / 2,5 h | **460 € / 2,5 h** |
| 4 | Setos 200 ml curativo ins >2 m | 520 € / 3,5 h | 520 € / 3,5 h | **520 € / 3,5 h** |
| 5 | Palmeras 4 ud preventivo ≤3 m | 160 € / 1 h | 160 € / 1 h | **160 € / 1 h** |
| 6 | Plantas 100 m² preventivo | 50 € / 1 h | 50 € / 1 h | — |
| 7 | Césped 1000 m² preventivo eco | 132 € / 2,5 h | 132 € / 2,5 h | **132 € / 2,5 h** |
| 8 | Césped 10 m² | 50 € / 1 h | 50 € / 1 h | **50 € / 1 h** |
| 9 | Césped 6000 m² (fuera de rango) | 1200 € / 13,5 h sin aviso | idem | bloqueado por la UI |
| 10 | Árboles 5 ud preventivo ≤3 m | 125 € / 1 h | 125 € / 1 h | **125 € / 1 h** |
| 11 | Árboles 5 ud preventivo >3 m | 200 € / 1 h | 200 € / 1 h | **200 € / 1 h** |
| 12 | Césped 5000 m² | 1000 € / 11,5 h | 1000 € / 11,5 h | sin huecos (T7) |

---

## 3 · Runner (Fase 2A)

`scripts/readiness/fitosanitarios.mjs`, reescrito. El heredado usaba el `serviceId` fantasma
`47a66caa-7671-45ec-b321-df6179249efd`, que no existe en este entorno: **todos** sus
escenarios morían en `missing_provider_config` sin medir nada. Van 5 de 5 servicios auditados
con el mismo problema.

```
READINESS_ENGINE=local SUPABASE_DB_CONTAINER=supabase_db_GarSer-referencia \
  node scripts/readiness/fitosanitarios.mjs

  34 PASA · 18 FALLA · 2 NO PROBADO
```

Los 18 fallos son los hallazgos, no ruido: el runner asevera **lo que el jardinero configuró**,
así que seguirá rojo hasta que el motor cobre eso. Cubre 26 tarifas de `detailed_pricing`, los
tres modificadores, los mínimos, los límites, la retirada y la paridad.

**Lo que el barrido demostró que sí funciona:** las 26 tarifas del camino de fotos facturan su
importe configurado (salvo la cirugía, #6), el recargo eco aplica su 10 % exacto, y **los dos
escalones de combo funcionan**, incluido el de 3+ tratamientos al 25 % (525 € medidos sobre
4 palmeras con ducha curativa + endoterapia) — que la referencia de la skill daba por
sospechoso de estar muerto. Lo está solo para el wizard manual, que no ofrece endoterapia (#8).

---

## 4 · Los 14 casos navegados

Servidor de **este worktree** en el puerto 5187, verificado por `lsof` + `cwd` del proceso
antes de medir nada. Sesión de cliente real (`cliente.local@test.local`).

| # | Caso | Pantalla | ¿Correcto? |
|---|---|---|---|
| 1 | Césped 1000 m² preventivo convencional | 200 € / 2,5 h | ✗ #1 (debería 120 €) |
| 2 | Césped 1000 m² curativo insectos+hongos | 460 € / 2,5 h | ✗ #2 (doble) |
| 3 | Setos 200 ml preventivo ≤2 m | 360 € / 3,5 h | ✗ #1 (debería 240 €) |
| 4 | Setos 200 ml curativo insectos >2 m | 520 € / 3,5 h | ✓ |
| 5 | Árboles 5 ud preventivo ≤3 m | 125 € / 1 h | ✗ #1 (debería 75 €) |
| 6 | Árboles 5 ud curativo hongos >3 m | 200 € / 1 h | ✗ #8 (cobra como mediano) |
| 7 | Palmeras 4 ud preventivo | 220 € / 1 h | ✗ #7 (altura heredada) |
| 8 | Palmeras 4 ud curativo ambos ≤3 m | 368 € / 1 h | ✗ #2 (doble) |
| 9 | Plantas 2000 m² preventivo | 400 € / 7 h | ✗ #1 y #4 |
| 10 | Plantas 2000 m² curativo insectos | 400 € / 7 h | ✗ idéntico al 9 |
| 11 | Césped 1000 m² preventivo ecológico | 132 € / 2,5 h | ✗ más barato que el convencional |
| 12 | Césped 10 m² (mínimo) | 50 € / 1 h | ✓ |
| 13 | Césped 5000 m² (11,5 h) | sin profesionales | ✗ mensaje engañoso (T1/T7) |
| 14 | Césped 6000 m² (fuera de rango) | bloqueado con aviso | ✓ |

Más el funnel completo: selección de fecha y hora → resumen → **pago real con tarjeta de
test** → aceptación del jardinero → captura en Stripe.

---

## 5 · Hallazgos transversales

Anotados en `docs/audit/COORDINACION-SERVICIOS.md` §3.2, **no arreglados**.

- **T1 (licencia fitosanitaria)** — confirmado y con evidencia nueva. El perfil del jardinero
  tiene el bloque de carnet, el configurador avisa «solo aparecerás en búsquedas de
  tratamientos ecológicos hasta que subas y se verifique tu carnet», y aun así el jardinero
  sembrado —sin licencia verificada— se ofrece y cobra **tratamientos químicos convencionales**
  en los 12 casos navegados que los pidieron. La promesa escrita al jardinero no se cumple.
- **T1, extensión nueva — el mensaje de exclusión miente sobre la causa.** Caso 13: con
  5000 m² (11,5 h, más que la jornada de 10 h) la pantalla dice *«Este servicio requiere una
  licencia fitosanitaria válida y ahora mismo no hay disponibilidad compatible en tu zona»* y
  *«Solo podemos mostrar profesionales con licencia fitosanitaria válida»*. La causa real es
  T7 (el trabajo no cabe en un día); el filtro de licencia que el texto invoca **no existe**.
  El mismo jardinero aparece sin problema para 1000 m².
- **T7 (trabajo que no cabe en la jornada)** — reproducido en fitosanitarios con 5000 m².
- **T6 y T9** — reproducidos de paso en «Solicitudes de Reserva»: «Cliente desconocido» en
  todas, y «09:00:00 - 12:00:00 (1h)» junto a «Duración estimada: 3h».
- **T2 (redondeo de horas >8 h)** — no se disparó con las entradas de este servicio; los
  rendimientos (400, 60, 300, 5, 4, 3) no producen el residuo binario. Sigue siendo aplicable.

---

## 6 · No probado

| Qué | Por qué | Qué haría falta |
|---|---|---|
| **Subida de fotos por la UI** | El panel Browser no tiene herramienta de subida; los `<input type=file>` son inalcanzables. | Prueba manual del recorte, compresión, límite de tamaño y estados de error. |
| **Flujo IA extremo a extremo (2B)** | El repo no trae fotos de muestra de plagas, y no se debe fabricar un análisis. El camino de fotos sí quedó medido a nivel de contrato inyectando `analysisMetrics` en el motor. | Un puñado de fotos reales de plaga por ámbito + `GOOGLE_API_KEY`. Es lo que cerraría #3 y #4 contra lo que Gemini devuelve de verdad. |
| **`valid_hours` / `preview_providers` por HTTP** | Solo existen en `booking-authority`; el motor en proceso no los expone. El calendario sí se verificó en la web (domingos fuera, horas acordes a la duración). | Ejecutar el runner por HTTP tras integrar en `main`. |
| **Validación de rangos declarados y puerta de licencia en la autoridad** | Viven en `booking-authority`, no en el motor. | Igual que arriba. |
| **Cambio de precio, cancelación, reseña y volver a reservar** | No ejecutados en este servicio. No son específicos suyos y ya se verificaron extremo a extremo en árboles y palmeras (T4 y §3.1.A), incluido el reembolso real de Stripe. | Repetirlos sobre una reserva de fitosanitarios si se quiere cobertura propia. |
| **Webhook de Stripe** | El pago se completó por `sync_payment_state`. | Ya probado por árboles con `stripe listen` (ver T11). |

---

## 7 · Acciones manuales del usuario

**Nada que desplegar.** Las fases 1 y 2 han sido de solo lectura: el único fichero modificado
es `scripts/readiness/fitosanitarios.mjs` (el runner), y no se ha tocado ni una línea de
código de producción, ni el motor, ni ningún fichero compartido.

Pendiente de tu decisión:

1. **Autorizar (o no) la Fase 3.** Los tres bloqueantes son de `bookingQuoteCore.ts`. #1, #2,
   #4 y #6 caben dentro del bloque fitosanitario sin tocar código compartido —el mismo patrón
   que césped y setos ya aplicaron dos veces—, así que no chocarían con otra rama. #3 es una
   línea en el bloque de horas. #5 y #7 son de UI (`PhytosanitaryPricingConfigurator.tsx` y el
   wizard manual), y #5 es el que más trabajo lleva: hay que construir los controles de 25+
   tarifas que hoy no existen.
2. **Una decisión de negocio previa a #1 y #2**, porque el arreglo depende de ella: cuando el
   cliente pide curativo contra insectos **y** hongos, ¿es una intervención con recargo de
   combo (lo que hace el camino de fotos: 230 €) o dos tratamientos facturables (lo que hace
   el manual: 460 €)? Los dos caminos no pueden seguir respondiendo cosas distintas, y cuál de
   los dos es el correcto no lo dice el código.
3. **Dejar el servidor de pruebas parado si no sigo**: quedó un `vite --port 5187` en marcha
   desde este worktree (PID visible con `lsof -nP -iTCP:5187 -sTCP:LISTEN`).

Una nota de método: `preview_start` arrancó dos veces Vite desde `/Users/javier/Downloads/GarSer-main 4`
—el checkout principal— en vez de este worktree, ignorando el `.claude/launch.json` con el
puerto 5187. Lo detecté comprobando el `cwd` del proceso antes de navegar, paré ese servidor y
levanté el mío. Todas las mediciones de la web son del código de esta rama. Si otras sesiones
usan `preview_start` sin comprobarlo, estarán auditando el checkout principal sin enterarse.

---

# Fase 3 — Corrección (2026-09-12)

Autorizada por el usuario, que además cerró la decisión de negocio pendiente:

> **Un combo son 2 tratamientos facturables independientes y no se aplica ningún porcentaje
> extra al precio: simplemente se calcula el precio de cada tratamiento y se suma.**

## Veredicto tras la corrección: **GO**, con una condición de despliegue

Los 13 hallazgos están corregidos, más **2 nuevos** que aparecieron al verificar en vivo. La
condición: **el orden de despliegue no es opcional** (ver §Acciones manuales). El front nuevo
declara variables que el motor viejo interpreta mal, así que si se publica el front antes de
redesplegar `booking-authority`, se cobra mal.

## 8 · Qué se ha cambiado

### El cambio de fondo: una sola tabla de precios

La raíz de los bloqueantes #1, #2 y #4 era que existían **dos** caminos de precio con **dos**
tablas: el flujo de fotos usaba `detailed_pricing` (tarifas por ámbito e intención) y el
manual unas estructuras derivadas por banda y tipo de producto. Esas derivadas mapeaban
`insecticida`/`fungicida` a la tarifa `*_curativo` **siempre**, de ahí que un preventivo se
cobrara como curativo y que «plantas bajas» se cobrara con la tarifa de césped.

Ahora hay **un solo camino**: una zona declarada a mano se traduce a las mismas métricas que
produce el análisis de fotos (`derivePhytosanitaryMetricsFromZone`), y el precio sale siempre
de `detailed_pricing`. Las estructuras derivadas se han eliminado, y con ellas el tipo que las
declaraba. Efecto colateral buscado: la paridad IA↔manual dejó de ser algo que comprobar y
pasó a ser algo que el diseño garantiza.

| # | Hallazgo | Qué se hizo | Dónde |
|---|---|---|---|
| 1 | Preventivos a tarifa curativa | Tabla única `detailed_pricing`, seleccionada por ámbito + porte + intención | `bookingQuoteCore.ts` (`derivePhytosanitaryMetricsFromZone`, `calculatePhytosanitaryQuote`) |
| 2 | Doble cobro del curativo «ambos» | `subtotal = base × nº de tratamientos`, **sin** recargo de combo (regla del usuario) | `bookingQuoteCore.ts` |
| 3 | Horas de plantas = 0 | Las horas usan las MISMAS métricas efectivas que el precio (`phytosanitaryHoursFromMetrics`) | `bookingQuoteCore.ts` |
| 4 | Plantas a tarifa de césped | Resuelto por la tabla única | `bookingQuoteCore.ts` |
| 5 | Configurador sin las 25+ tarifas | **La causa no era que faltaran los controles**: existían, ocultos tras `config.pricing_method === 'per_quantity'`, y el profesional sembrado no tiene esa clave. Ahora se resuelve con `getPricingMethod()`, la misma función que usa el motor | `PhytosanitaryPricingConfigurator.tsx` |
| 6 | Cirugía con recargo de combo | Cirugía y endoterapia se facturan por pieza, fuera del conteo de tratamientos | `bookingQuoteCore.ts` |
| 7 | El interruptor de altura heredaba | Solo se pregunta en setos, y con `defaultValue: false` explícito | `manualEntrySchema.ts` |
| 8 | 12 tarifas inalcanzables | Paso nuevo «¿De qué tamaño son?» (3 portes para árboles, palmeras y plantas) y paso «¿Quieres endoterapia?» | `manualEntrySchema.ts`, `manualEntryBuilders.ts`, `manualEntryValidation.ts` |
| 9 | Mínimos por ámbito muertos | Se aplican como suelo por línea, junto al mínimo global | `bookingQuoteCore.ts` |
| 10 | Retirada de restos inerte | El servicio deja de preguntarla, de resumirla y de declararla (`serviceAsksForWasteRemoval`) | `manualEntrySchema.ts`, `ManualEntryWizard.tsx`, `ManualEntrySummary.tsx`, `manualEntryBuilders.ts` |
| 11 | Mínimo triplicado | Una sola resolución (`??`, respeta el 0 explícito) documentada en un punto | `bookingQuoteCore.ts` |
| 12 | Banda `mas_de_100m2` fantasma | Desaparece con las estructuras derivadas | `bookingQuoteCore.ts` |
| 13 | Sin aviso de plausibilidad | `pushWarning('phytosanitary_area_implausible')` por encima de 5000, mismo patrón que césped/setos/palmeras | `bookingQuoteCore.ts` |

### Los dos hallazgos nuevos, encontrados al verificar

**#14 (Grave) · Cada guardado del configurador disparaba el precio de la endoterapia de
65 a 160 €/tronco.** `toPersistedPhytosanitaryConfig` escribía
`palmeras.endoterapia.precio_unico = maxCirugia`, confundiendo dos servicios distintos: la
endoterapia se cobra por tronco inyectado y la cirugía por ejemplar intervenido. Reproducido
en vivo con SQL antes/después: bastó cambiar el precio del césped y guardar para que la
endoterapia pasara de 65 a 160 (+146 %), en silencio. Ahora se conserva el valor configurado,
y **se ha añadido su campo propio** en la sección de palmeras del configurador, que no
existía. `src/utils/phytosanitaryConfig.ts:251`

**#15 (Menor) · Compatibilidad con configuraciones v1.** Al eliminar las estructuras
derivadas, un profesional con configuración antigua —sin `detailed_pricing`— habría pasado a
cotizar 0 y habría desaparecido del mercado sin aviso. Lo detectó un test existente. Se añadió
`detailedPricingFromLegacyConfig`, que convierte v1 → v2 heredando la tarifa del insecticida
para preventivo y curativo, que es lo que esos profesionales cobraban de facto.
`src/shared/bookingQuoteCore.ts`

## 9 · Verificación

```
READINESS_ENGINE=local node scripts/readiness/fitosanitarios.mjs
  74 PASA · 0 FALLA · 2 NO PROBADO      (antes: 34 PASA · 18 FALLA)

npx vitest run                → 437/437  (434 antes + 3 nuevos de regresión)
npx tsc --noEmit -p tsconfig.app.json → 172 errores  (main arrastra 173: uno menos, ninguno nuevo)
```

El runner incorpora un bloque nuevo (**7b**) que barre los nueve portes y comprueba, uno a uno,
que el camino manual y el de fotos dan **el mismo precio y las mismas horas**.

### En el navegador, sobre el servidor de este worktree (puerto 5187)

| Qué | Resultado |
|---|---|
| Configurador: tarifas visibles | **de 9 campos a 35**, con los valores exactos de la BD; el suplemento de combo ya no está |
| Configurador: campo de endoterapia | presente por primera vez, con su explicación |
| Guardar no corrompe | tras guardar, `endoterapia.precio_unico` sigue en **65** (antes saltaba a 160) |
| Cadena configurador → BD → motor | cambiar césped 0,12 → 0,30 en la UI hizo que el motor facturara **300 €** en vez de 120 € |
| Wizard: paso de tamaño | aparece con los tres portes en árboles, palmeras y plantas |
| Wizard: paso de endoterapia | aparece solo en palmeras |
| Wizard: altura | ya solo en setos, y arranca en `false` en cada zona nueva (hallazgo #7) |
| Wizard: retirada de restos | **ya no se pregunta ni se resume** |
| Persistencia | `booking_manual_declarations.declared_variables` guarda `sizeBand: "medianas"` y `wantsEndotherapy: true` |
| Pago completo | reserva `8e9bd8dc-e555-4eef-b540-2a2bf3fa573f`, PaymentIntent `pi_3UEf012MwFyGXuB71cKV2oYg`: `requires_capture` (4875 cts autorizados) → tras aceptar el profesional, `confirmed` y **`succeeded`, `amount_received: 4875`** |

### Lo que el navegador NO puede validar todavía, y por qué

**Los precios que muestra la web salen del motor viejo.** El stack de Supabase compartido lo
sirve `~/Downloads/GarSer-referencia`, que está en `main` y no tiene estas correcciones
(`grep -c derivePhytosanitaryMetricsFromZone` → 0 allí, 2 aquí). Comprobado con el mismo
payload exacto:

```
10 árboles GRANDES preventivo
  motor de referencia (lo que sirve la web) → 250 €   ← el bug original
  motor de esta rama (en proceso)           → 400 €   ← 10 × 40, lo configurado
```

Por eso los precios de pantalla de esta fase **no** son evidencia del arreglo; la evidencia
son el runner y los tests, que sí corren contra este código. Se cerrará por HTTP tras el
merge y el redespliegue (paso 5 de §4 en `COORDINACION-SERVICIOS.md`).

## 10 · Transversales: sin tocar

- **T1** (licencia) y su extensión nueva (el mensaje de exclusión que culpa a la licencia
  cuando la causa es T7) — anotados en `COORDINACION-SERVICIOS.md` §3.2.
- **T6, T9, T10** reproducidos de paso y ya anotados: «(1h)» fijo en la cabecera de solicitudes,
  «Cliente desconocido», y «08:00 – 9.5:00» en `ProvidersPage`.
- **El patrón de `pricing_method` comparado en crudo está en los 6 configuradores.** Solo se
  manifiesta si al profesional le falta la clave, y hoy solo le falta a **fitosanitarios**
  (corregido aquí) y a **desbroce** (sin tocar: es de otra auditoría). Anotado como T12.
- **`BookingRequestsManager` sigue mostrando «Retirada de restos incluida»** aunque el flag
  llegue en `false`; el componente es compartido, así que aquí solo se corrigió el origen del
  dato. Anotado como T13.

---

# Anexo — Verificación por HTTP contra el motor corregido (2026-09-12)

La Fase 3 se cerró con una salvedad: los precios que mostraba la web salían del motor viejo,
porque el Supabase compartido lo servía el checkout de referencia. El usuario autorizó cerrarla
levantando una instancia propia desde este worktree. **Salvedad resuelta.**

## Cómo

Al no haber otras sesiones activas, se paró el stack de referencia (sus datos quedan en su
volumen de Docker, intactos) y se arrancó `supabase start` **desde este worktree**. Los
contenedores pasan a llamarse `supabase_*_fitosanitarios` y el edge runtime monta los ficheros
de esta rama — comprobado:

```
docker inspect supabase_edge_runtime_fitosanitarios →
  /Users/javier/Downloads/auditorias/fitosanitarios/src/shared/bookingQuoteCore.ts
```

## Un hallazgo del propio montaje

**Los `serviceId` cambian cada vez que se recrea la base local**: `seed.sql` los genera con
`gen_random_uuid()`, no son fijos. El de fitosanitarios pasó de `fc96088a-…` a
`d4e65cea-…` sin que nadie tocara nada. **Esto explica los «serviceId fantasma» que las cinco
auditorías anteriores encontraron en sus runners heredados**: no era que la skill estuviera
desactualizada, es que el id caduca con la base. El runner ya no lo lleva escrito: lo resuelve
por nombre con una consulta (`PHYTOSANITARY_SERVICE_ID` lo sobrescribe si hace falta).

## Resultado

```
node scripts/readiness/fitosanitarios.mjs        (HTTP, sin READINESS_ENGINE)
  78 PASA · 0 FALLA · 1 NO PROBADO
```

El único NO PROBADO es la puerta de licencia (T1, transversal). El bloque de disponibilidad,
que antes no podía ejecutarse, ahora pasa de verdad — y de paso se corrigió: **las dos
aserciones anteriores pasaban por la razón equivocada**, porque las llamadas no llevaban
dirección y `booking-authority` respondía `missing_coordinates` sin llegar a mirar el
calendario. Ahora comprueba los cuatro casos que importan:

| Caso | Resultado |
|---|---|
| Martes laborable | 8 horas ofrecidas |
| Domingo | sin horas · `no_reservable_availability` |
| Dirección cubierta | el profesional aparece |
| Dirección fuera de cobertura | excluido · `outside_coverage` |

## Los bloqueantes, ya en pantalla

Con la web cotizando contra el motor corregido:

| Caso navegado | Antes (motor de `main`) | Ahora | Configurado |
|---|---|---|---|
| Césped 1000 m² preventivo | 200 € | **120 €** | 1000 × 0,12 ✓ |
| Césped 1000 m² curativo insectos+hongos | 460 € | **400 €** | 2 × 200, sin recargo ✓ |
| 10 árboles **grandes** preventivo | 250 € | **400 €** | 10 × 40 ✓ |

El tercero es el más ilustrativo: ese porte ni siquiera era declarable antes de esta rama.

**Pago real de principio a fin contra el motor nuevo:** reserva
`1fc77a3a-97c0-4a2b-bd6b-18cf9df15424` (400 € / 3 h), PaymentIntent `pi_3UEoby2MwFyGXuB71a4Hux02`
en `requires_capture` (5000 cts autorizados, 0 cobrados) → tras aceptar el profesional,
`confirmed` y **`succeeded` con `amount_received: 5000`**.

## Rectificación: T13 era un falso positivo

Se había anotado que el panel del profesional seguía mostrando «Retirada de restos incluida»
pese a llegar `wasteRemoval: false`. Falso: el panel **sí** condiciona al flag. Lo que se
observó era una reserva creada antes del cambio del builder, con `true` ya guardado. Con una
reserva nueva (`declared_variables.wasteRemoval = false`) el panel no la menciona. La fila
queda tachada en `COORDINACION-SERVICIOS.md` para que nadie la vuelva a anotar.

## Estado del entorno al terminar

El stack de este worktree queda **levantado y sirviendo el código corregido**. Para devolver
el entorno compartido a su sitio, ver la última sección de acciones manuales.
