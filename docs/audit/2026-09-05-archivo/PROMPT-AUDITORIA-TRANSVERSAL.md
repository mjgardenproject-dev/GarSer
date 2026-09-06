# Prompt para el chat de la auditoría transversal

> Pégalo tal cual. Es el primer chat de la nueva tanda: va antes que los siete de servicio.

---

Necesito una auditoría de preparación para producción del **tronco común** de GarSer: todo
lo que comparten los siete servicios. No auditas ningún servicio en concreto — de eso se
encargan otros siete chats después de ti, y tu trabajo es dejarles el suelo firme.

## Sobre qué código trabajas

La base es **`origin/main`**, que es lo que hay en producción. Nada de ramas locales
antiguas: `git fetch origin` y sales de ahí.

Trabaja en tu propio worktree. El stack local de Supabase ya está levantado desde un
checkout de referencia con `main` limpio: **no lo reinicies** — hay más sesiones usándolo, y
si lo levantas desde tu directorio dejas de medir lo que crees.

Copia `.env.local` del checkout de referencia a tu worktree antes de nada.

## Qué auditar, y dónde está el límite

Acótate al **ciclo de vida de la reserva y al dinero**. Es donde más duele equivocarse:

1. **Pago.** Creación del PaymentIntent, captura, importes, qué se cobra ahora y qué queda
   pendiente al profesional. Stripe está configurado en local con claves de test y el pago
   se puede completar de verdad.
2. **Cambio de precio.** El profesional lo propone, el cliente lo acepta o lo rechaza.
   Verifica el importe en pantalla y en `bookings`.
3. **Cancelación**, por los dos lados, con el movimiento de dinero en Stripe y en la base.
4. **Cierre del servicio** y **reseña**: que la reseña se vea y la media se actualice.
5. **Volver a reservar** desde el área de cliente.
6. **Listado de profesionales**: que un cliente recién registrado vea a alguien, y que no
   se filtren datos personales.
7. **Disponibilidad**: huecos reales, cobertura, duración bloqueada.

**Fuera del alcance de esta ronda**, aunque los veas de reojo: chat, emails, notificaciones,
panel de admin, landings públicas. Anótalos si son graves, pero no los audites.

Y no toques nada específico de un servicio: si un fallo solo afecta a palmeras o solo a
césped, lo anotas y sigue. No es tuyo.

## Cómo probar el pago

El `PaymentElement` de Stripe es un iframe de otro origen y tiene truco: **`computer` con
`key` escribe dentro, con `type` no** (y no da error, solo deja el campo vacío). Los dígitos
uno a uno, nunca con `repeat`, y `Tab` para cambiar de campo porque los clicks no cruzan
entre iframes. Tarjeta `4242 4242 4242 4242`, caducidad `12/30`, CVC `123`. El botón
«Pagar» sí está en la página y se pulsa normal.

Comprueba el resultado **en Stripe**, no solo en pantalla:

```bash
SK=$(grep -m1 "^STRIPE_SECRET_KEY=" supabase/functions/.env | cut -d= -f2)
curl -s -u "$SK:" "https://api.stripe.com/v1/payment_intents/<pi_...>"
curl -s -u "$SK:" "https://api.stripe.com/v1/refunds?payment_intent=<pi_...>"
```

Un pago que la pantalla da por bueno y Stripe deja en `requires_capture` es dinero retenido
al cliente que nadie ha cobrado.

## No toques código hasta que yo lo diga

**La auditoría es de solo lectura.** Lees, mides, pruebas, tomas notas. No editas, no
arreglas, ni siquiera lo que sea evidente y de dos líneas. Cuando termines, me presentas el
informe con el veredicto y **te paras**. Yo te diré cuándo corregir.

Sí puedes escribir tus notas y el fichero de hallazgos.

## Lo que ya sabemos — no lo redescubras

En la rama `archivo/auditorias-2026-09`, en `docs/audit/2026-09-05-archivo/`, tienes los
hallazgos de la tanda anterior **ya contrastados contra `origin/main`**. Léelo antes de
empezar. En resumen:

**Confirmado que sigue roto en main:**
- No existe ningún reembolso, en ninguna parte. El cliente paga la tarifa de reserva, el
  profesional rechaza, la reserva se cancela y el dinero no vuelve.
- El cliente no puede cancelar su reserva desde su área: solo tiene «Chat».
- El redondeo de horas: `totalHours *= 0.9` deja un residuo de coma flotante que el techo a
  media hora amplifica. Lo encontraron tres auditorías por separado.
- No hay puerta de licencia fitosanitaria: un profesional sin carnet puede ser reservado
  para un tratamiento con producto convencional.
- El panel del jardinero ofrece «Servicio Completado» en reservas que aún no han empezado, y
  luego el backend las rechaza con un mensaje que no se ve.

**Ya resuelto en main — NO lo vuelvas a arreglar:**
- El catálogo público de profesionales: existe `public_gardener_directory`.
- La captura del pago: main usa captura diferida **a propósito** (`capture_method: 'manual'`
  con captura al confirmar, PR #9). Poner `automatic` rompería ese diseño.

## Decisión mía que ya tienes tomada

Sobre reembolsos y cancelación, la política es la siguiente:

> _(rellena esto antes de pegar el prompt: qué pasa si cancela el cliente con antelación,
> qué pasa si cancela con el profesional de camino, qué pasa si cancela el profesional, y
> si hay penalización para alguna de las partes)_

Si algo de lo que encuentres depende de una decisión de negocio que no está aquí, no la
inventes: pregúntamela.

## Qué quiero de vuelta

Un informe con:

1. **Veredicto**: GO o NO-GO, y si es NO-GO, la lista numerada de bloqueantes.
2. **Hallazgos** con severidad, `file:line`, qué falla y fix propuesto.
3. **Evidencias literales**: la respuesta JSON, la fila de la base de datos, la captura. Un
   «funcionaba bien» no es evidencia.
4. Lo que **no hayas podido probar**, marcado NO PROBADO, con lo que haría falta para
   cerrarlo. No lo cuelas como PASA.
