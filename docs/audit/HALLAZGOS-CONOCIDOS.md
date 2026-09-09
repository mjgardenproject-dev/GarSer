# Pistas de una auditoría anterior — para verificar, no para creer

En septiembre de 2026 hubo una tanda de auditorías que se hizo sobre **una base de código
distinta de `main`**: una línea local que nunca se subió a GitHub. Sus conclusiones
describen un código que no es el que tienes delante.

**Nada de lo que hay aquí es un hallazgo. Son pistas de dónde mirar.** Antes de escribir en
tu informe que algo falla, compruébalo tú contra el código actual. Ya ha pasado que un
"fallo confirmado" de aquella tanda resultara estar perfectamente resuelto en `main`.

## Cómo usar esta lista

Para cada punto: ve al fichero, míralo, y decide por ti mismo. Si está resuelto, no lo
menciones. Si sigue roto, entonces sí es tuyo y lo documentas con la evidencia que hayas
obtenido tú, no con la de aquí.

## Pistas comprobadas contra `main` el 2026-09-05

Estas dos **seguían presentes** en el momento de escribir esto. Verifícalas igualmente, por
si alguien las ha tocado desde entonces:

- **Redondeo de horas.** `src/shared/bookingQuoteCore.ts:1349`, `if (totalHours > 8)
  totalHours *= 0.9;`. La multiplicación deja un residuo de coma flotante que el redondeo
  posterior a media hora amplifica, y a veces suma media hora de más. Tres auditorías lo
  encontraron por separado creyendo cada una que era un fallo de su servicio.
- **Puerta de licencia fitosanitaria.** `booking-authority` no comprueba
  `has_phytosanitary_license`: cero referencias. Un profesional sin carnet puede ser
  reservado para un tratamiento con producto convencional, que es lo que reserva a quien lo
  tiene el RD 1311/2012 — y lo que su propio panel le promete al cliente por escrito.

## Pistas que resultaron ser FALSAS en `main`

Se afirmaron en la tanda anterior y **no se cumplen** en el código actual. Están aquí para
que no pierdas tiempo ni las repitas:

- ~~«No existe ningún reembolso»~~ → **Sí existe.** `booking-payment/index.ts` llama a
  `/v1/refunds` de Stripe cuando la acción de dinero es `refund`.
- ~~«El cliente no puede cancelar su reserva»~~ → **Sí puede.** `BookingsList.tsx:136` tiene
  el botón con su diálogo de confirmación.
- ~~«El catálogo de profesionales deja fuera a los clientes nuevos»~~ → **Resuelto.** Existe
  `public_gardener_directory` y el listado la usa.

## Un diseño que NO hay que "arreglar"

`booking-payment` usa `capture_method: 'manual'` **a propósito**: al reservar solo se
autoriza el importe, y se captura cuando la reserva se confirma (PR #9, "captura diferida").
Es deliberado. En la tanda anterior alguien lo tomó por un fallo y lo cambió a `automatic`,
lo que habría cobrado al cliente antes de que el profesional aceptara.

Si ves algo que parece un error pero está comentado como decisión, léelo dos veces antes de
tocarlo.

## Lo que sí quedó verificado como cierto y sigue siendo útil

- La reseña de penalización del sistema **está implementada**: `booking_lifecycle_rpcs.sql`
  inserta en `reviews` con `is_system_penalty` y `system_reason` cuando corresponde. Si tu
  auditoría toca cancelaciones, comprueba que se dispara y que se distingue de una opinión
  real, pero no la construyas de cero.
