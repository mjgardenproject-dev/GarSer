# Plan de integración de las seis auditorías

Estado a 2026-09-05. Sustituye al §4 del fichero de coordinación, que daba por buena una
base equivocada.

---

## Paso 0 — Producción, hoy

Producción tiene desplegada una versión de `booking-payment` que no coincide con ninguna
rama conocida y que **puede estar dejando pagos autorizados sin capturar**: el cliente ve
el cargo retenido y no hay reserva.

**Redesplegar `booking-payment` y `booking-authority` desde `origin/main` tal cual**, sin
fixes de ninguna rama de auditoría.

```bash
git checkout origin/main -- supabase/functions/booking-payment supabase/functions/booking-authority
supabase functions deploy booking-payment --use-api
supabase functions deploy booking-authority --use-api
```

Después, comprobar en el panel de Stripe que no hay PaymentIntents en `requires_capture`
de los últimos días. Si los hay, son clientes con dinero retenido y sin servicio: hay que
capturarlos o cancelarlos uno a uno, y decidir qué se les dice.

**Hasta que esto esté hecho, nadie despliega nada.**

## Paso 1 — Decidir qué pasa con la línea local

Hay dos historias paralelas desde `a8de8cf`:

- **Línea local** (`98b54ae`): 8 commits — emails, chat, wizard, tarjetas de jardinero,
  disponibilidad, endurecimiento. Nunca subida a GitHub. Es de donde salieron los seis
  worktrees.
- **`origin/main`** (`50a6031`): PR #8–#16 haciendo el mismo trabajo. **Es lo que hay en
  producción.**

Por los títulos de las PR, la línea local ya está cubierta por main. Antes de darlo por
hecho, conviene comprobarlo con:

```bash
git diff origin/main 98b54ae --stat
```

Si no aparece nada que main no tenga, **la línea local se abandona** y `origin/main` pasa a
ser la única base. Si aparece algo que solo existe ahí, se rescata en una PR propia antes
de seguir.

Esta es la decisión que desbloquea todo lo demás.

## Paso 2 — Cada chat contrasta sus hallazgos contra `origin/main`

Antes de rebasar nada, cada auditoría comprueba si lo que arregló sigue roto en main:

```bash
git diff 98b54ae origin/main -- src/shared/bookingQuoteCore.ts      # ¿cambió mi bloque?
git diff 98b54ae origin/main -- <los ficheros que toqué>
```

Tres resultados posibles, y qué hacer con cada uno:

| Resultado | Qué hacer |
|---|---|
| El fichero es idéntico en las dos líneas | El arreglo aplica tal cual. Es el caso de fitosanitarios |
| Main lo resolvió de otra forma | **Descartar el arreglo propio** y quedarse con el de main. Es el caso del catálogo de jardineros y del `capture_method` |
| Main cambió el fichero pero el fallo sigue | Rehacer el arreglo sobre la versión de main, no portar el diff a ciegas |

El resultado se anota en el fichero de coordinación §0.3.

## Paso 3 — Rehacer la rama transversal desde `origin/main`

`claude/plataforma-transversal` se descarta: salió de la base equivocada y dos de sus cinco
arreglos sobran. Se crea `plataforma/v2` desde `origin/main` con lo que sobrevive:

- Puerta de licencia fitosanitaria (no existe en main).
- Guarda del botón «Servicio Completado» (no existe en main).
- Catch de `booking-complete`, tras releer el fichero en main.
- Redondeo de horas: **uno solo** de los dos commits gemelos (`6a43401` de arbustos o
  `a2395c3` de desbroce; son funcionalmente idénticos).
- Los transversales de césped+setos que sigan haciendo falta: huérfanos de `hold_blocks`,
  aviso `long_job_review`, seguridad del análisis IA (commit `36b1698`).
- El `_harness.mjs` común.

Cada uno en su commit, para poder quitar el que se caiga en revisión.

## Paso 4 — Un servicio cada vez

1. Entra `plataforma/v2` en `main`.
2. Cada chat rebasa sobre `main` y **reejecuta su runner**. Si deja de estar verde, el
   conflicto se resolvió mal: parar y avisar.
3. Entra **una** rama de servicio.
4. Se ejecutan **todos** los runners, no solo el recién integrado.
5. Volver al 2 con el siguiente.

Orden sugerido, de menos a más superficie tocada: fitosanitarios → arbustos → desbroce →
árboles → palmeras → césped+setos. Palmeras va tarde a propósito porque su rama necesita
reconstruirse (ver Paso 5).

## Paso 5 — Casos que necesitan trabajo extra

**Palmeras (`71595e`).** Fusionó `origin/main` dentro de su rama (commit `67401b3`, 204
ficheros, 9 conflictos resueltos a mano) y su commit `d8930e9` mezcla servicio y tronco
común. Además sus fixes dependen de las PR #13/#14, que solo existen en main. Ahora que
main es la base, eso deja de ser un problema: **rebasar sobre `origin/main` y reaplicar
encima solo sus tres fixes**, en commits separados. El merge de 204 ficheros se descarta.

**Césped+setos (`214f6d`).** Lleva dos servicios en una rama. **Mantenerlos juntos**: se
auditaron a la vez, comparten commit, y separarlos ahora cuesta más de lo que ahorra. Su
cambio en `ProvidersPage.tsx` (texto de estado vacío) hay que rehacerlo sobre la versión de
main, porque main ya reescribió ese fichero.

**Desbroce.** Su rama ya está limpia. Queda pendiente confirmar qué quedó desplegado en
producción y que el Paso 0 lo revierte.

**Árboles.** No puede teclear el número de tarjeta en el formulario de Stripe. Solución
práctica: que deje la pantalla de pago abierta, teclees tú los 16+4+3 dígitos, y siga él
con todo lo posterior, que no necesita tarjeta.

## Paso 6 — Lo que sigue sin decidirse

Ninguna rama debe tocar esto hasta que haya una decisión:

- **Reembolsos.** No existen en ninguna parte. El cliente paga, el profesional rechaza y el
  dinero no vuelve. Hace falta política antes que código.
- **Cancelación por parte del cliente.** No hay botón. Depende de lo anterior.
