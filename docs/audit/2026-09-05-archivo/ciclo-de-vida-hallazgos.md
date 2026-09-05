# Ciclo de vida de la reserva — lo que se probó y lo que salió

Ejecutado el 2026-09-05 con la tarjeta de test de Stripe (`4242 4242 4242 4242`) sobre el
entorno local, con el código de esta rama servido por la edge function.

**Veredicto: el ciclo funciona de punta a punta, con dos bloqueantes de dinero pendientes
de decisión tuya.**

---

## 1. Lo que se probó y pasó

| Paso | Resultado | Evidencia |
|---|---|---|
| Pago con tarjeta | **PASA** (tras corregir) | PaymentIntent `succeeded`, `amount_received: 1500` |
| Reserva creada tras el pago | **PASA** | `f26140ca…` · `pending` · 120,00 € · 16/09 10:00-13:00 |
| Importes del desglose | **PASA** | 135,00 € = 120 € servicio + 15 € tarifa; pagas ahora 15 € |
| Jardinero propone cambio de precio | **PASA** | `price_change_status: pending_client_acceptance`, `proposed_total_price: 180.00` |
| Cliente acepta el nuevo precio | **PASA** | `confirmed` · `total_price: 180.00` · `price_change_status: accepted` |
| Cierre del servicio por el jardinero | **PASA** (tras corregir) | `{"success":true,"outcome"…}` → `completed` |
| Regla «no se puede cerrar antes de empezar» | **PASA** | 400 `Todavía no puedes marcarla: el servicio no ha empezado` |
| Reseña del cliente | **PASA** | `reviews`: 5.0 + comentario, ligada a la reserva |
| Media del profesional | **PASA** | 3,25 (6) → **3,50 (7)** = (3,25×6+5)/7 |
| La reseña se ve | **PASA** | el listado de profesionales muestra «3.5 (7)» |
| Volver a reservar | **PASA** | segunda reserva completa: 112,50 € = 100 € + 12,50 € |
| Cancelación por el jardinero | **PASA** (el estado) | `respond_booking_request(…, 'reject')` → `cancelled` |
| Segundo pago en la interfaz | **PASA** | pantalla «RESERVA CONFIRMADA» tras pagar 12,50 € |

## 2. Lo que se corrigió para que el ciclo pudiera completarse

Están en el commit `6d42895`.

1. **El adelanto se cobraba y la reserva no se creaba.** `createPaymentIntentForAttempt`
   no enviaba `capture_method`, así que heredaba el default de la cuenta de Stripe —en
   captura manual— y el PaymentIntent quedaba en `requires_capture`. `sync_payment_state`
   no contemplaba ese estado, de modo que el intento se quedaba en `payment_pending` para
   siempre. **El cliente tenía 15 € retenidos, ninguna reserva y ningún mensaje.** Ahora
   `capture_method` es explícito y el sync captura si encuentra un pago autorizado.
2. **El catch de `booking-complete` descartaba el motivo.** Hacía `error instanceof Error`
   y los errores de supabase-js son objetos planos: devolvía siempre "Error interno".
3. **El jardinero no veía por qué fallaba el cierre.** El servicio del front tiraba el
   mensaje del cuerpo de la respuesta y mostraba "inténtalo de nuevo".
4. **«Servicio Completado» se ofrecía en reservas futuras.** El backend las rechaza con
   razón; el botón ahora solo aparece cuando el servicio ya ha empezado.

## 3. Bloqueantes que quedan, y por qué no los he tocado

### 3.1 · No existe ningún reembolso. En ninguna parte.

**Evidencia.** El cliente paga 12,50 € de tarifa → el profesional rechaza la solicitud →
la reserva pasa a `cancelled` → en Stripe: `reembolsos: 0`, el cargo sigue `succeeded` con
1250 capturados, y `booking_payment_attempts` sigue en `booking_created`.

Una búsqueda de `refund` en todo el repositorio no devuelve una sola línea: no hay lógica
de reembolso ni en las edge functions ni en el front.

**El cliente paga, el profesional rechaza, y el cliente se queda sin servicio y sin su
dinero.** Afecta a los siete servicios, no solo a fitosanitarios.

No lo he implementado porque no es un fallo con una única respuesta técnica: hace falta
decidir la política. Quién asume la tarifa según quién cancele y con cuánta antelación,
si hay penalización, si el reembolso es total o parcial, y qué pasa con el importe
pendiente al profesional. Dímelo y lo implemento; inventármelo sería peor que dejarlo
señalado.

### 3.2 · El cliente no puede cancelar su reserva

En «Mis Reservas» no hay ningún control de cancelación: una reserva pendiente solo ofrece
«Chat». El único «Cancelar» de esa pantalla es el del modal de reseña. El profesional sí
puede rechazar; el cliente no tiene salida por la interfaz.

Depende de la misma decisión que 3.1: sin política de reembolso, un botón de cancelar deja
el dinero en el aire igual.

## 4. Hallazgos menores del ciclo

| Dónde | Qué falla |
|---|---|
| Panel del jardinero, tarjeta de solicitud | Dice **«Cliente desconocido»**: el nombre del cliente no se resuelve |
| Panel del jardinero, tarjeta de solicitud | La cabecera dice **«10:00:00 - 13:00:00 (1h)»** cuando el bloque es de 3 h, y más abajo la misma tarjeta dice «Duración estimada: 3h» |
| Panel del jardinero, detalle | Sigue mostrando **«Retirada de restos incluida»** en fitosanitarios, donde ya no se ofrece ni se cobra |
| «Mis Reservas» del cliente | El botón **«Valorar» no cambia** en una reserva ya valorada. El modal sí protege contra duplicados y muestra la reseña existente, pero la etiqueta invita a valorar otra vez |
| `gardener_profiles` | Dos pares de columnas de valoración: `rating`/`total_reviews` (las escribe el front) y `rating_average`/`rating_count` (las mantiene la base). Hoy coinciden (3,50/7); el día que diverjan, el cliente verá una media y el sistema otra |

## 5. Nota para el merge

Seis edge functions difieren entre esta rama (salida de `main`) y el checkout principal,
que está en `fix/pagos-emails-geocoding`: `ai-pricing-estimator`, `booking-complete`,
`booking-confirmation-email`, `booking-payment-webhook`, `booking-telemetry` y
`send-email-notification`. Mis correcciones de pago están sobre la versión de `main`; al
integrar habrá que resolver esa divergencia a mano, sobre todo en `booking-complete`, que
en la otra rama tiene un flujo distinto (devuelve `outcome: finished` en vez de marcar
`completed`).

## 6. Lo que sigue sin probarse

- **Análisis real con Gemini.** El botón «Datos de prueba» del modo desarrollo inyecta el
  análisis pero **reinicia el contexto del tratamiento**, y al volver a elegir preventivo o
  curativo el análisis se invalida y hay que reanalizar — lo que exige `GOOGLE_API_KEY`,
  que no está configurada en local. Sigue haciendo falta la clave y 2-3 fotos de plaga.
- **Subida de fotos por la interfaz**: recorte, compresión, límite de tamaño, errores.
- **El webhook de Stripe**: falta `STRIPE_WEBHOOK_SECRET` en local. El pago se confirma
  igualmente porque el front sincroniza contra Stripe, pero el camino del webhook no se ha
  ejercitado.
