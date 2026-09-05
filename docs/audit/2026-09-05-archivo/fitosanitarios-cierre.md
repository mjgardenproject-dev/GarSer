# Servicios fitosanitarios — cierre de la corrección

**Veredicto: GO con dos acciones manuales tuyas** (despliegue y pago con tarjeta).

Los 8 bloqueantes están corregidos y verificados ejecutando. Lo que queda no es código:
es desplegar lo hecho y cerrar las dos pruebas que un agente no puede ejecutar.

---

## 1. Qué se ha corregido

| # | Bloqueante | Estado | Cómo se verificó |
|---|---|---|---|
| 1 | Preventivo cobrado a tarifa curativa | Corregido | Césped 1000 m² preventivo: **200 € → 120 €**. Runner, escenario E1 |
| 2 | «Plantas bajas» facturadas con precios de césped | Corregido | 500 m² medianas curativo: **100 € → 160 €**. Barrido, 6 claves |
| 3 | Palmeras ignoraba `intent` | Corregido | 5 altas preventivo: **200 € → 250 €**; curativo **375 €**. Barrido, 6 claves |
| 4 | Árboles solo tenía dos bandas | Corregido | 10 grandes curativo: **250 € → 650 €**. Barrido, 6 claves |
| 5 | Guardar en el configurador subía los precios | Corregido | Hash de `additional_config` idéntico tras pulsar «Por Cantidad» (`81f01233…`); endoterapia sigue a 65 € |
| 6 | Las tarifas no se veían sin pulsar un botón | Corregido | Panel abierto en el navegador: `tieneTarifas: true` sin tocar nada |
| 7 | Un cliente nuevo no veía ningún profesional | Corregido | Funnel completo **sin sesión**: aparece Miguel Ángel Ruiz, `gardener_public_catalog → 200 OK` |
| 8 | La licencia fitosanitaria no filtraba a nadie | Corregido | Sin carnet: convencional excluido con `missing_phytosanitary_license`, ecológico sigue disponible |

Además, los 13 hallazgos graves y menores del informe anterior: mínimos por ámbito,
desglose que cuadra con el cobro, `tratamientos_activos` simétrico, endoterapia
contratable a mano, bandas unificadas, mensaje de lista vacía honesto, aviso de
plausibilidad, herbicida con explicación en vez de un 422 mudo, mínimo aplicado una sola
vez, y el fixture llevado a `seed.sql`.

### Una decisión de negocio que cambia precios

Combinar insecticida y fungicida cobraba dos tarifas completas **y** un 15 % encima por el
camino manual, mientras que por fotos cobraba una tarifa y el 15 %. Elegiste cobrar cada
producto entero y quitar el recargo: **1000 m² curativo «ambos» pasa de 460 € a 400 €**, y
los dos campos de combo desaparecen del configurador. Es el único precio que baja por
decisión y no por corrección de un fallo.

---

## 2. Papel vs. realidad, después del arreglo

| Escenario (declarado a mano) | Según la configuración | Antes | Ahora |
|---|---|---|---|
| Césped 1000 m² preventivo | 120,00 € | 200,00 € | **120,00 €** |
| Setos 100 ml bajos preventivo | 120,00 € | 180,00 € | **120,00 €** |
| Árboles 10 ud pequeños preventivo | 150,00 € | 250,00 € | **150,00 €** |
| Árboles 10 ud grandes curativo | 650,00 € | 250,00 € | **650,00 €** |
| Palmeras 5 ud medianas preventivo | 175,00 € | 275,00 € | **175,00 €** |
| Palmeras 5 ud altas curativo | 375,00 € | 200,00 € | **375,00 €** |
| Plantas 500 m² grandes curativo | 225,00 € | 100,00 € | **225,00 €** |
| Plantas 20 m² (mínimo del ámbito) | 45,00 € | 50,00 € | **45,00 €** |
| Palmeras 1 ud (mínimo del ámbito) | 60,00 € | 50,00 € | **60,00 €** |

Desviación cero en las 37 claves del barrido.

---

## 3. Guion de verificación

| Paso | Resultado | Evidencia |
|---|---|---|
| 2A · runner completo por HTTP | **68 PASA · 0 FALLA · 0 NO PROBADO** | `node scripts/readiness/fitosanitarios.mjs` |
| 2A · barrido de las 28 tarifas + modificadores + mínimos | PASA | tabla §2 |
| 2A · paridad fotos ↔ manual (6 parejas) | PASA | mismo precio y mismas horas en los dos caminos |
| 2A · límites manuales | PASA | 6000 m² → `422 manual_input_invalid` |
| 2A · plausibilidad | PASA | 5000 m² → aviso con el texto que ve el cliente |
| 2A · licencia (3 casos) | PASA | `missing_phytosanitary_license` / ecológico disponible / con carnet vuelve |
| 2A · disponibilidad y cobertura | PASA | domingo sin horas, Barcelona `outside_coverage` |
| 2C.a · tarifas visibles sin pulsar nada | PASA | `tieneTarifas: true` al abrir |
| 2C.a · guardar no mueve precios | PASA | hash `81f01233…` idéntico antes y después |
| 2C.a · cambiar una tarifa sí llega al cliente | PASA | 50 → 60 €/ud ⇒ 250 € → 300 € → 250 € al restaurar |
| 2C.a · controles nuevos | PASA | endoterapia + los 5 mínimos por ámbito; sin recargo de combo |
| 2C.b · wizard manual completo **sin sesión** | PASA | tamaño, modo de aplicación, sin retirada de restos |
| 2C.c · listado de profesionales sin sesión | PASA | `gardener_public_catalog → 200 OK` |
| 2C.d · pantalla de pago | PASA | **281,25 €** = 250 € + 31,25 € · 1,5 h |
| 2C.i · consola y red | PASA | sin errores; el 401 de `gardener_profiles` ha desaparecido |
| Suite del repo | PASA | **375 tests en 64 ficheros** |
| `tsc` y `npm run build` | PASA | sin errores |
| 2B · análisis real con Gemini | **NO PROBADO** | sin `GOOGLE_API_KEY` local y sin fotos de plaga en el repo |
| 2C.d · pago con tarjeta | **NO PROBADO** | `PaymentElement` en iframe de otro origen |
| 2C.e-h · ciclo de vida posterior al pago | **NO PROBADO** | depende del pago |
| Subida de fotos por la UI | **NO PROBADO** | el panel no puede rellenar `<input type=file>` |

---

## 4. Red de regresión

```bash
node scripts/readiness/fitosanitarios.mjs
```

Desde este worktree, indicando dónde se levantó el stack:

```bash
SUPABASE_PROJECT_DIR="/Users/javier/Downloads/GarSer-main 4" node scripts/readiness/fitosanitarios.mjs
```

Sale con código 1 si algo falla. Hay un modo en proceso (`READINESS_ENGINE=local`) que mide
el motor sin pasar por la edge function: útil para iterar, pero **no cierra nada** — deja
como NO PROBADO la validación de rangos y la puerta de licencia, que viven en la autoridad.

El configurador reescribe la configuración del jardinero al guardarse, así que tras
cualquier paso por el navegador:

```bash
./scripts/readiness/restore-fixture.sh fitosanitarios
```

---

## 5. Acciones manuales del usuario

**1. Aplicar la migración.**

```bash
supabase db push
```

Crea `gardener_public_catalog` y `gardener_has_phytosanitary_license`. Sin ella, el listado
de profesionales queda vacío para todos: el front ya lee la vista.

**2. Redesplegar la autoridad de precios.** Importa `bookingQuoteCore`, así que el cambio
del motor no llega al backend hasta que se redespliega:

```bash
supabase functions deploy booking-authority --use-api
```

**3. Desplegar el front** (Vercel), que trae el wizard, el configurador y el listado.

**4. Revisar las tarifas de cada jardinero real.** Los precios preventivos llevaban desde
siempre sin facturarse: es la primera vez que van a cobrarse de verdad. Conviene que cada
profesional entre una vez al configurador y confirme que las cifras son las que quiere,
sobre todo las de plantas, la banda de «grandes» en árboles y las tres de palmeras.

**5. Verificar el carnet fitosanitario de quien lo tenga.** A partir de ahora, sin carnet
verificado el profesional deja de aparecer en tratamientos con producto convencional. Si
alguien lo tiene subido pero sin verificar en el panel de admin, se quedará fuera.

**6. Ejecutar la batería de producción**:
`docs/audit/2026-09-04/PRUEBAS-PRODUCCION-fitosanitarios.md`. Va pegada dentro de
`docs/audit/2026-07-12/PRUEBAS-PRODUCCION.md`, que vive en la rama
`fix/pagos-emails-geocoding`; está aparte para no pisar sus 665 líneas desde otra rama.

**7. Cerrar lo que no he podido ejecutar:**
- `GOOGLE_API_KEY` en `supabase/functions/.env` y 2-3 fotos reales de plaga, para verificar
  el análisis con Gemini de punta a punta. No lo he simulado a propósito: una paridad
  verificada contra datos inventados parece una garantía y no lo es.
- Pago con `4242 4242 4242 4242`, y detrás el ciclo completo: cambio de precio aceptado,
  cancelación por los dos lados, reseña y volver a reservar.
- La subida de fotos por la interfaz: recorte, compresión, límite de tamaño y estados de error.

### Nota sobre el entorno local

El stack de Supabase de esta máquina se levantó desde el checkout principal, que está en
la rama `fix/pagos-emails-geocoding`: la edge function local sirve **ese** código, no el de
este worktree. Para medir por HTTP tomé prestado el checkout principal unos minutos y lo
he devuelto a su estado original (limpio, misma rama). Si quieres reproducir las pruebas
por HTTP aquí, hay que mergear esta rama o levantar el stack desde este worktree; mientras
tanto, `READINESS_ENGINE=local` mide el motor sin depender de eso.
