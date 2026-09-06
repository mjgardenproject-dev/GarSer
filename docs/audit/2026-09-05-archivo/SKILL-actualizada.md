---
name: garser-service-production-readiness
description: >-
  Auditoría de preparación para producción de UN servicio del marketplace GarSer
  (cesped, setos, arboles, palmeras, arbustos, desbroce, fitosanitarios), de extremo a
  extremo y con veredicto GO / NO-GO. Comprueba el papel (código: configuración del
  jardinero, paridad IA↔manual, motor de precios, cálculo de horas, ciclo de vida de la
  reserva, disponibilidad, persistencia) y después comprueba la realidad ejecutando el
  entorno local con las cuentas sembradas, porque la lectura del código se equivoca.
  Úsala SIEMPRE que el usuario diga "comprueba el servicio X con la skill", "revisa X de
  punta a punta", "¿está X listo para producción?", "audita el servicio X", "verifica que
  el precio y las horas de X cuadran", "prueba X de verdad en local", "quiero sacar X a
  producción sin incongruencias", o cuando pida asegurarse de que un servicio concreto
  funciona igual en la configuración del jardinero, en el flujo con fotos, en el flujo
  manual y en el importe que se cobra. Úsala también si pide un barrido de recargos,
  extras o suplementos de un servicio, o si sospecha que un recargo configurado no se
  está aplicando.
---

# Preparación para producción de un servicio GarSer

Esta skill cierra una pregunta concreta: **¿puedo sacar este servicio a producción sin
que un cliente pague de más, pague de menos, o reserve un hueco que no cuadra con el
trabajo real?**

El servicio a auditar lo dice el usuario. Si no lo dice, pregúntalo antes de empezar:
auditar los siete de golpe produce un informe que nadie lee y que no distingue un fallo
de caja de un detalle estético.

## Por qué hay tres fases y por qué el orden importa

La Fase 1 lee el código y construye una hipótesis numérica. La Fase 2 la ejecuta contra
el entorno real. Existen las dos porque **leer el código y ejecutarlo dan resultados
distintos con más frecuencia de la que resulta cómodo admitir**: un recargo puede estar
perfectamente escrito y no llegar nunca al motor porque quien construye el payload usa
otro nombre de clave. Ese fallo es invisible leyendo, y evidente ejecutando.

De ahí las dos reglas que gobiernan todo lo demás:

**La Fase 1 no cierra nada.** Un servicio solo es GO si se ha ejecutado. Si el papel dice
X y la ejecución dice Y, gana la ejecución y es BLOQUEANTE — no "revisar", no "warning":
bloqueante, porque una discrepancia entre lo que crees que cobras y lo que cobras es
exactamente el fallo que no puedes permitirte descubrir en producción.

**No marques PASA sin evidencia.** Cada paso lleva pegada la respuesta JSON, la fila SQL,
la captura o la línea de log que lo demuestra. Si un paso no se pudo ejecutar, se marca
NO PROBADO y va a la sección de acciones manuales. Inferir un PASA leyendo el código
anula el motivo por el que existe la Fase 2, y es una tentación real cuando quedan pocos
pasos y todos los anteriores han ido bien.

Esta skill audita y corrige. No rediseña, no toca otros servicios y no cambia una regla
de negocio sin que el usuario lo apruebe: si el precio de algo te parece mal calibrado
pero el código hace lo que la configuración dice, eso es una observación para el informe,
no un cambio.

## No toques código hasta que el usuario te lo diga

**Las fases 1 y 2 son de solo lectura. Ni un fichero de código.** Lees, mides, ejecutas el
runner, tomas notas. No editas, no arreglas, no "de paso ya que estoy". Aunque el fallo sea
evidente y el arreglo sean dos líneas.

Esto no es prudencia excesiva: es que hay siete auditorías compartiendo el mismo motor de
precios, y un arreglo bienintencionado en el momento equivocado obliga a resolver a mano un
conflicto en el fichero donde equivocarse significa cobrarle mal a un cliente.

Al terminar la Fase 2 **te paras y presentas el informe**. La Fase 3 no empieza hasta que
el usuario diga explícitamente que corrijas. Si crees que algo es tan urgente que no puede
esperar, dilo en el informe y espera igual.

Sí puedes escribir, en cualquier momento: tu runner (`scripts/readiness/<servicio>.mjs`),
tus notas, y el fichero común de hallazgos transversales.

## Dónde trabajas y sobre qué código

Tres cosas que hay que tener claras antes de medir nada, porque equivocarse aquí hace que
midas código que no es el tuyo y no te enteres:

**La base es `origin/main`, siempre.** Es lo que hay en producción. Nunca partas de otra
rama local ni de un commit que alguien te señale: `git fetch origin` y de ahí. Si tu rama
no sale de `origin/main`, todo lo que midas describe un código que nadie va a desplegar.

**Tu sitio es tu worktree**, y solo el tuyo. Hay uno por servicio. No edites nada fuera de
él —ni el checkout de referencia, ni el worktree de otro servicio— aunque tengas permisos
para hacerlo.

**Mide con el motor en proceso, no por HTTP.** El stack local de Supabase lo sirve un
checkout de referencia que tiene `main` limpio, no tu worktree: si llamas por HTTP a
`booking-authority` estás midiendo *otro* código. Durante toda la auditoría:

```bash
READINESS_ENGINE=local node scripts/readiness/<servicio>.mjs
```

La prueba por HTTP se hace **una sola vez**, después de que tu rama esté mezclada en `main`
y desplegada. Ese es el GO de verdad. Antes de eso, un `PASA` por HTTP no significa nada.

Un aviso que ya costó caro: hay pruebas que solo existen en la autoridad y no en el motor
—la validación de rangos declarados y la puerta de licencia—. En modo local salen como NO
PROBADO, y eso es correcto: no las marques PASA.

## Las dos reglas de alcance

Hay seis auditorías en marcha a la vez, una por servicio, cada una en su rama. El motor de
precios de los siete servicios vive en un solo fichero, así que aunque cada rama toque solo
su servicio, todas editan las mismas líneas. De ahí estas dos reglas:

**No toques el servicio de otro.** Ni su configurador, ni su bloque del motor, ni su
encuesta manual, ni su runner. Si al pasar ves algo roto en otro servicio, se anota y sigue.

**Un hallazgo que afecta a más de un servicio se documenta, no se arregla aquí.** Va a
`docs/audit/COORDINACION-SERVICIOS.md` §3.2 y se decide aparte. Esta es la regla que
importa: la primera evita el desorden, esta evita que dos ramas se peleen por el motor de
precios, que es el único sitio donde un conflicto mal resuelto cuesta dinero.

Cómo distinguirlos, en una frase: **si el arreglo sirve igual para un servicio que no
estás auditando, es transversal.**

### Qué es tuyo y qué no

| Tuyo — puedes corregirlo cuando el usuario lo autorice | No es tuyo — se anota, no se toca |
|---|---|
| El configurador de tu servicio (`*PricingConfigurator.tsx`) | Los configuradores de los otros seis |
| Tu bloque dentro de `bookingQuoteCore.ts` | Lo que ese fichero hace **antes o después** de los bloques: el redondeo final de horas, el mínimo, el desglose, la elegibilidad general |
| Tu encuesta en `manualEntrySchema.ts` y tu builder | Las encuestas y builders de otros servicios |
| Tu runner y tu fixture | El harness común `_harness.mjs` |
| Las reglas de negocio de tu servicio (`*BusinessRules.ts`) | `ProvidersPage`, el pago, la cancelación, las reseñas, el chat, los emails, la autenticación |

La columna izquierda es estrecha a propósito. Cuando dudes de qué lado cae algo, es de la
derecha: anótalo y sigue.

### El fichero común de hallazgos transversales

`docs/audit/COORDINACION-SERVICIOS.md`, §3.2. Ahí va todo lo de la columna derecha, con:

- qué falla y dónde (`file:line`),
- cómo lo reprodujiste,
- a qué servicios crees que afecta,
- y si ya estaba anotado por otra auditoría (búscalo antes de escribir: tres sesiones
  llegaron a apuntar el mismo fallo de redondeo por separado).

Ese fichero se vacía en una **ronda transversal final**, cuando los siete servicios hayan
pasado. No esperes que se arregle durante tu turno.

Y antes de empezar, lee ese mismo fichero: te dice qué ficheros compartidos está tocando
cada rama y qué hallazgos transversales ya están corregidos, para que no los vuelvas a
arreglar. Al terminar, añade tu servicio al registro de §2.

## Antes de empezar

Carga las reglas de negocio de la skill `garser-pricing-rules`. Es la fuente de verdad de
rendimientos, mínimos, comisión y activación; no deduzcas reglas de precio leyendo el
motor, porque el motor es justo lo que estás auditando. Para las dimensiones de paridad y
de flujo, `garser-ai-analysis-flows` y `garser-manual-entry` ya tienen criterio formado
sobre esos dos caminos: reutilízalo en vez de improvisar uno nuevo.

Lee `references/servicios.md` para el servicio que te toque. Trae el `serviceId` real, la
forma exacta del `bookingInput`, las claves de `additional_config` que el jardinero
sembrado tiene configuradas y qué módulo las factura. Sin eso, la Fase 1 predice sobre
suposiciones.

---

# FASE 1 — EL PAPEL

Recorre estas ocho dimensiones. Cada hallazgo lleva `file:line` y el fragmento que lo
demuestra: prohibido concluir por el nombre de un fichero.

1. **Configuración del jardinero → qué puede contratar el cliente.** Cada variable,
   recargo y extra configurable tiene efecto real en el precio y es alcanzable desde el
   flujo del cliente. Y al revés: nada que el cliente pueda elegir queda sin configurar
   ni sin precio.
2. **Paridad IA ↔ manual.** Mismas variables, rangos, unidades y recargos, y mismo precio
   para el mismo input físico. Busca variables presentes en un camino y ausentes en el otro.
3. **Cálculo de precio.** La cadena completa hasta el importe cobrado: mínimos, redondeos,
   cero explícito frente a default, unidades (m², ml, ud, h), suplementos de estado /
   acceso / retirada de restos, extras y complementarios, y coherencia entre el precio que
   se muestra y el autoritativo del backend.
4. **Cálculo de tiempo.** Toda variable que mueve el precio y el trabajo real entra en las
   horas, y las horas calculadas son las que bloquean el calendario.
5. **Ciclo de vida.** Reserva, cambio de precio y revisión de variables, aceptación, pago
   y reembolso, cancelación por ambos lados, finalización, reseña y volver a reservar.
6. **Filtrado y disponibilidad.** Servicio activo, distancia y huecos reales dejan pasar a
   los jardineros correctos y solo a esos.
7. **Persistencia.** Lo calculado es lo guardado y lo releído, sin campos huérfanos ni
   snapshots desincronizados.
8. **Coherencia con la vida real.** Valores imposibles, límites de plausibilidad, avisos.

## El entregable que hace falta para la Fase 2

Una **tabla de predicciones** de al menos 5 escenarios, calculados a mano con las tarifas
reales del jardinero sembrado: input → variables → subtotales → recargos → precio final →
horas. Incluye siempre un caso base, uno que active el mínimo, uno con recargo de estado,
uno con retirada de restos o extra, y uno fuera de rango.

Calcularlos a mano importa más de lo que parece. Es lo que convierte la Fase 2 en una
prueba falsable en lugar de un paseo por la pantalla: sin un número esperado, mirar el
resultado no demuestra nada, porque cualquier cifra parece razonable hasta que la
comparas con la que debía salir.

## Dónde mirar

Puntos de entrada, no lectura del proyecto entero:

- **Motor y SSOT** — `src/domain/pricingEngine.ts`, `src/domain/pricing/`,
  `src/domain/hedgeBusinessRules.ts`, `src/domain/speciesBusinessRules.ts`,
  `src/shared/bookingQuoteCore.ts`, `src/shared/bookingAmounts.ts`
- **Autoridad backend** — `supabase/functions/booking-authority/` (importa
  `bookingQuoteCore`: si tocas el motor hay que redesplegarla), `booking-payment`,
  `booking-manual-declaration`, `booking-complete`
- **Flujo IA** — `src/utils/aiPricingEstimator.ts`, `src/domain/ai/`,
  `src/shared/analysisV2*.ts`, `supabase/functions/ai-pricing-estimator/`
- **Flujo manual** — `src/shared/manualEntry/`,
  `src/pages/reserva/manualEntryBuilders.ts`, `src/components/booking/manual/`
- **Configurador del jardinero** — `src/components/gardener/*PricingConfigurator.tsx`
- **Fixture** — `supabase/seed.sql`
- **Disponibilidad** — tabla `availability` + `booking-authority`. La cadena client-side
  `mergedAvailability` / `bufferService` / `AvailabilityPage` está muerta: ignórala.
- **Tests** — los `*.test.ts` junto a cada módulo

---

# FASE 2 — LA REALIDAD

## Arranque

**No levantes Supabase.** Ya hay un stack corriendo, levantado desde el checkout de
referencia que sirve `main` limpio. Si lo reinicias desde tu worktree se lo quitas a las
otras seis auditorías y además dejas de medir lo que crees.

Si necesitas comprobar que está vivo:

```bash
docker ps --format '{{.Names}}' | grep supabase_db
```

Copia `.env.local` del checkout de referencia a tu worktree antes de nada: sin él, nueve
ficheros de test fallan con «Falta VITE_SUPABASE_URL» y el formulario de Stripe no carga.

El dev server se levanta con `preview_start { name: "garser-dev" }`, nunca con Bash. Las
claves locales salen de `supabase status` (ejecutado en el checkout de referencia, o con
`SUPABASE_PROJECT_DIR` apuntando a él). Para SQL:

```bash
docker exec -i supabase_db_GarSer-main_4 psql -U postgres -d postgres -c "..."
```

El fixture ya está sembrado por `supabase/seed.sql`: jardinero
`jardinero.local@test.local` / `Test123456!` ("Miguel Ángel Ruiz",
`11111111-aaaa-4aaa-8aaa-111111111111`) con **los 7 servicios activos** y tarifas,
rendimientos, recargos, extras y mínimos ya configurados; cliente
`cliente.local@test.local` / `Test123456!`; cobertura desde Marbella, L-V 08:00–18:00 y
S 09:00–14:00 con domingo libre, 220 huecos. No hay que configurar nada para empezar.

`docs/audit/2026-07-12/PRUEBAS-LOCALES.md` está desactualizado y dice que solo césped
está activo. La verdad es `supabase/seed.sql` y la propia base de datos.

Dos cosas del entorno que cuestan una hora si no se saben:

- **Copia `.env.local` del checkout principal a tu worktree** antes de nada. Sin él, nueve
  ficheros de test fallan con «Falta VITE_SUPABASE_URL» y el `PaymentElement` de Stripe no
  carga. No es un fallo de tu código.
- **La edge function local sirve el checkout de referencia, no tu worktree.** Por eso toda
  la auditoría se mide con `READINESS_ENGINE=local`, y la prueba por HTTP se deja para
  después de integrar. Está explicado arriba, en «Dónde trabajas y sobre qué código».

## 2A · Contrato ejecutable

Es el grueso de la prueba y el que da confianza real, porque es exacto y repetible.

`booking-authority` usa el mismo motor que la web —importa `bookingQuoteCore`— y se
invoca por HTTP. La acción `recalculate_correction` devuelve precio y horas con solo
`{action, serviceId, providerId, bookingInput}` y la apikey: **sin sesión, sin fecha y sin
hueco**. Eso la convierte en el instrumento ideal para medir el motor de forma aislada.
Los contratos exactos, con ejemplos que ya se han ejecutado contra este entorno, están en
`references/contratos-http.md`.

Copia el harness a `scripts/readiness/_harness.mjs` del repo y escribe el runner del
servicio en `scripts/readiness/<servicio>.mjs`:

```bash
mkdir -p scripts/readiness
cp .claude/skills/garser-service-production-readiness/scripts/authorityHarness.mjs \
   scripts/readiness/_harness.mjs
```

Se copia al repo, en vez de ejecutarse desde la skill, para que el runner siga
funcionando cuando la skill no esté delante: lo que queda es la red de regresión del
servicio, no un apaño de una tarde.

El runner ejecuta siete bloques:

1. **Escenarios.** Los 5 de la tabla de predicciones. Compara precio al céntimo y horas a
   la centésima, e imprime esperado vs. obtenido en cada fallo.
2. **Paridad.** El mismo input físico enviado dos veces, una con `dataInputMode: 'manual'`
   y otra con el payload del flujo de fotos. Los dos totales y las dos duraciones deben
   coincidir.
3. **Barrido de variables.** Para *cada* clave del `additional_config` —cada recargo, cada
   extra, cada banda, cada tramo de matriz— dos llamadas, con y sin, y el delta debe ser
   exactamente el esperado. Este bloque es el que más rinde: caza las dos formas de fallo
   que ya han aparecido varias veces en este proyecto, el recargo que nunca llega a
   aplicarse y el cero explícito del jardinero pisado por un default. Una clave cuyo delta
   sea 0 cuando debería mover el precio es BLOQUEANTE.
4. **Límites.** Valores fuera de rango devuelven 422 `manual_input_invalid` con sus
   errores de validación, y no se truncan en silencio. Las superficies absurdas disparan
   el aviso de plausibilidad.
5. **Mínimo.** Un input diminuto factura el `minimum_price` del servicio.
6. **Cambio de precio.** `recalculate_correction` con las variables corregidas por el
   jardinero devuelve el total recalculado por el mismo motor.
7. **Disponibilidad.** `valid_hours` en domingo no devuelve horas, y `preview_providers`
   desde una dirección fuera de cobertura excluye al jardinero con su código de exclusión.

Una trampa al construir payloads: **omitir un flag no equivale a ponerlo a `false`**.
Con `wasteRemoval` ausente el motor cobra la retirada de restos igual que con `true`. Si
el runner omite flags para representar "sin extra", medirá deltas de cero y concluirá que
el extra no se aplica, cuando el fallo está en la prueba. Declara siempre el valor.

## 2B · El camino IA, sin navegador

`ai-pricing-estimator` recibe `photo_urls`, no ficheros, y `isAllowedImageUrl` exige que
sean URLs de `/storage/v1/` del mismo host de Supabase — no valen rutas de disco, ni
`data:`, ni hosts externos. Así que el camino con IA se prueba entero sin tocar un
`<input type=file>`:

1. Sube 2–3 fotos reales del servicio al bucket `booking-photos` del Storage local con la
   service_role key.
2. Genera una URL firmada de cada una.
3. Llama a `ai-pricing-estimator` con esas `photo_urls` y el `service_id`.
4. Valida la respuesta con `validateAnalysisV2` y comprueba que las variables extraídas
   tienen el tipo, la unidad y el rango que el motor espera.
5. Mete esa salida en el motor y compara con el escenario equivalente de 2A.

Si el repo no tiene fotos de muestra del servicio, dilo y pídelas. No inventes un análisis
ni simules la respuesta de Gemini: una paridad IA↔manual verificada contra datos
fabricados es peor que no verificarla, porque parece una garantía y no lo es.

## 2C · Navegador, para lo que solo el navegador demuestra

2A y 2B prueban que el motor calcula bien. Esto prueba que la interfaz está cableada a ese
motor y que una persona real llega hasta el final. Herramientas del panel Browser:
`read_page`, `computer`, `form_input`, `read_console_messages`, `preview_logs`,
`read_network_requests`.

a. **Configurador del jardinero.** Contrasta la UI contra el `additional_config` real de
   la base de datos: cada clave del JSON debe tener su control, y cada control debe
   escribir una clave que el motor lea. Las huérfanas en cualquiera de las dos direcciones
   son hallazgo. Cambia un valor, guarda, relee y comprueba que el precio del cliente se
   mueve en consecuencia.
b. **Wizard manual completo** como cliente, hasta ver precio y horas. No tiene ningún
   input de fichero, así que es clicable de principio a fin. Los números deben coincidir
   con el escenario equivalente de 2A: si la UI muestra algo distinto de lo que devuelve
   la autoridad, es BLOQUEANTE aunque el motor esté bien.
c. **Listado de jardineros.** Aparece Miguel Ángel Ruiz con su precio y sus huecos. Prueba
   un domingo (sin huecos) y una dirección fuera de cobertura (no aparece).
d. **Reserva** hasta la pantalla de pago; verifica el desglose cliente/jardinero.
e. **Pago con la tarjeta de test.** Stripe está configurado en local con claves de test y
   el pago se puede completar de verdad — ver más abajo cómo teclear dentro del iframe.
   Verifica en Stripe que el PaymentIntent queda `succeeded` con el importe capturado, y en
   `bookings` que la reserva se ha creado con el precio y las horas que decía la pantalla.
f. **Cambio de precio**: el jardinero lo propone, el cliente lo acepta. Verifica el nuevo
   importe en pantalla y en `bookings` (`total_price`, `price_change_status`).
g. **Cancelación** por los dos lados, verificando el movimiento de dinero —captura,
   reembolso, penalización— en Stripe y en la base de datos.
h. **Finalización y reseña**: el jardinero cierra el servicio, el cliente valora, la reseña
   se ve y la media del jardinero se actualiza.
i. **Volver a reservar** el mismo servicio desde el área de cliente.
j. **Cierre**: consola, logs del server y peticiones de red sin errores.

### Cómo pagar con la tarjeta de test

Esto es lo único del funnel que tiene truco, y sin saberlo parece imposible.

El `PaymentElement` es un iframe de otro origen: **`computer` con `type` no escribe dentro,
pero `key` sí**. Un `type` deja el campo vacío sin dar error, que es justo lo que hace
pensar que no se puede.

1. Click aislado en el campo del número —no dentro de un `browser_batch`, o el click se
   adelanta al render y se pierde el foco.
2. Los dígitos, **uno a uno**, con `key`. Nada de `repeat`: `repeat: 8` con "4" escribe
   `44444444`, no `42424242`.
3. `key: "Tab"` para pasar de campo. **Los clicks no cruzan entre los iframes de Stripe**,
   y `Backspace` tampoco llega: si te equivocas, cierra el modal de pago y vuelve a abrirlo
   con «Reabrir pago» en vez de intentar corregir.
4. Tarjeta `4242 4242 4242 4242`, caducidad `12/30`, CVC `123`.
5. El botón «Pagar» sí está en la página, no en el iframe: se pulsa normal.

Tras confirmar, el front sincroniza contra Stripe con `sync_payment_state`, así que **el
pago se completa sin necesidad del webhook** (en local falta `STRIPE_WEBHOOK_SECRET`, y aun
así la reserva se crea). El camino del webhook queda sin ejercitar: dilo en el informe.

Comprueba el resultado en Stripe, no solo en pantalla:

```bash
SK=$(grep -m1 "^STRIPE_SECRET_KEY=" supabase/functions/.env | cut -d= -f2)
curl -s -u "$SK:" "https://api.stripe.com/v1/payment_intents/<pi_...>"
curl -s -u "$SK:" "https://api.stripe.com/v1/refunds?payment_intent=<pi_...>"
```

Un pago que la pantalla da por bueno y Stripe deja en `requires_capture` es dinero retenido
al cliente que nadie ha cobrado. Y una cancelación sin reembolso es dinero que el cliente
ha perdido: los dos casos ya han aparecido en este proyecto, así que se miran siempre.

## Lo que no se puede ejecutar, y hay que decirlo

Queda una sola cosa fuera del alcance del agente. El informe la declara; no la disimula ni
la cuela como PASA.

- **Subida de fotos por la UI.** El panel Browser no tiene herramienta de subida de
  ficheros, así que los `<input type=file>` del funnel son inalcanzables. 2B cubre el
  camino IA a nivel de contrato, pero el componente de subida en sí —recorte, compresión,
  límite de tamaño, estados de error— queda sin probar.

Se marca NO PROBADO y pasa a la sección de acciones manuales.

**El pago sí se puede ejecutar**, y con él todo el ciclo posterior: cambio de precio,
aceptación, cancelación por los dos lados, cierre del servicio, reseña y volver a reservar.
Ya no valen como NO PROBADO: si no los has ejecutado, es que faltan por hacer.

El botón «Datos de prueba» del modo desarrollo de la Details Page inyecta un análisis sin
subir fotos, pero **reinicia el contexto del tratamiento**: al volver a elegir las opciones,
el análisis se invalida y hay que reanalizar, lo que exige `GOOGLE_API_KEY`. No sirve para
saltarse 2B; sí para ver la forma de las métricas que produce el flujo de fotos.

---

# FASE 3 — CORRECCIÓN

**Esta fase no empieza sola.** Al terminar la Fase 2 te paras, presentas el informe y
esperas a que el usuario diga que corrijas. Puede querer sacar el servicio con un fallo
menor conocido, o que tu turno vaya después de otro servicio: esa decisión es suya y
depende de cosas que tú no ves.

Cada fix se cierra reejecutando el runner de 2A y los pasos de 2C que cubran el fallo. Un
fix sin reejecución no está cerrado, está escrito.

**Dónde va cada arreglo.** Lo de tu servicio, en tu rama. Lo transversal, ni se toca: se
documenta en `docs/audit/COORDINACION-SERVICIOS.md` §3.2 y espera a la ronda final. Si el
usuario te pide expresamente arreglar algo transversal, hazlo **en un commit aparte**, para
que se pueda separar después sin rehacer el trabajo.

**Cierra tu servicio así:**

1. Runner en verde con el motor en proceso:
   ```bash
   READINESS_ENGINE=local node scripts/readiness/<servicio>.mjs
   ```
2. `npx tsc --noEmit -p tsconfig.json` y `npx vitest run` sin fallos.
3. Presentas el informe con el veredicto y **esperas**. La PR la abre el usuario.

**Después de que tu rama entre en `main`** —esto lo coordina el usuario, no tú—:

4. Se despliega, y el orden importa. Al revés se rompe: un front nuevo contra un backend
   viejo, o una función que usa una tabla que todavía no existe.

   ```bash
   supabase db push
   ```
   ```bash
   supabase functions deploy booking-authority --use-api
   ```
   Y por último el front (Vercel). El flag `--use-api` no es opcional en esta máquina: sin
   él el deploy se cuelga esperando a Docker. Redespliega también cualquier otra función que
   hayas tocado; `booking-authority` importa `bookingQuoteCore`, así que un cambio en el
   motor no llega al backend hasta que se redespliega.

5. **Se ejecutan todos los runners que existan, no solo el tuyo**, ahora sí por HTTP:

   ```bash
   for r in scripts/readiness/*.mjs; do node "$r" || echo "FALLA $r"; done
   ```

   Es lo único que detecta que arreglar tu servicio ha roto otro. Si uno se pone rojo, se
   para el despliegue del siguiente servicio hasta entenderlo.

6. Se traduce la batería a producción en el documento de pruebas y se ejecuta contra
   garser.es.

---

# El informe

La plantilla completa está en `references/informe.md`. Va al final de la conversación y
además se traduce a producción en `docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md`.

Termina siempre con la sección **"Acciones manuales del usuario"** —migraciones, deploys
de edge functions, y todo lo declarado NO PROBADO—. Si de verdad no hay nada, escribe
"(nada que desplegar)": el usuario necesita distinguir "no hay nada pendiente" de "se me
olvidó mirarlo".

# Ficheros de esta skill

- `references/contratos-http.md` — payloads, auth y respuestas de `booking-authority` y
  `ai-pricing-estimator`, con ejemplos ya ejecutados contra el entorno local.
- `references/servicios.md` — por servicio: id, forma del `bookingInput`, claves de
  `additional_config` sembradas y matriz de barrido.
- `references/informe.md` — plantilla de salida.
- `scripts/authorityHarness.mjs` — harness a copiar al repo como
  `scripts/readiness/_harness.mjs`.
