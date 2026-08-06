# Prompt 06 — Sistema de emails automáticos: completar sobre la capa de marca ya creada

> Sesión nueva, en frío. Proyecto **GarSer** (React+Vite+TS, Supabase Auth + Edge Functions Deno + Brevo). Apóyate en la skill **`supabase`** (plantillas de Auth y Edge Functions).

## Estado actual (verificado 2026-08-03)

- **`supabase/functions/_shared/emailBrand.ts`** — capa compartida de marca:
  `BRAND`, `renderBrandedEmail()`, `detailRows()`, `formatPrice()`, `formatBookingDate()`,
  `escapeHtml()` y `sendViaBrevo()`. **Todos los emails deben usar esta capa.**
- **`supabase/functions/_shared/bookingEmailDetails.ts`** — resuelve en el servidor los
  detalles de una reserva y devuelve los bloques de importes **por audiencia**
  (`clientPairs` / `gardenerPairs`), usando el SSOT `src/shared/bookingAmounts.ts`.
  Lo consumen las dos funciones de email, para que las etiquetas no puedan divergir.
- **`send-email-notification`** — sobre la capa compartida. Contrato de reserva: solo
  `{ type, bookingId }`; el importe, el servicio, la fecha y los nombres se resuelven con
  service-role. Autorización: servicio interno, participante de la reserva, o admin para los
  tipos `gardener_*`. No acepta destinatario libre.
- **`booking-confirmation-email`** — migrada a la capa compartida y separada por audiencia.
- `nodemailer` ya no está en `package.json`.

### Importes en los emails (cerrado el 2026-08-03)

Al **cliente** se le muestran siempre dos cifras: *Total de la reserva* y *Pendiente de pagar
al profesional*, más una nota que indica si los gastos de gestión están **retenidos**
(reserva pendiente) o **cobrados** (confirmada). Al **jardinero**, solo *Cobrarás*, íntegro.
La comisión sale de `bookings.management_fee`, nunca de recalcular el 12,5 %.

## Casos cubiertos

| Evento | Destinatario | Estado |
|---|---|---|
| Solicitud de jardinero aprobada / rechazada | jardinero | ✅ |
| Confirmación de reserva pagada | cliente + jardinero | ✅ |
| Nueva solicitud de reserva recibida | jardinero | ✅ |
| Reserva aceptada / rechazada | cliente | ✅ |
| Reserva cancelada | cliente | ✅ |
| Solicitud de jardinero **recibida** | jardinero | ❌ |
| Cambio de precio propuesto / resuelto | cliente / jardinero | ❌ (hoy solo mensaje de chat) |
| Recordatorio de servicio próximo | ambos | ❌ (valorar pg_cron) |
| Mensaje de chat sin leer | destinatario | ❌ (agrupar; solo si offline; anti-spam) |
| Cuenta: verificación, reset password, bienvenida | usuario | ❌ plantillas Supabase Auth sin personalizar |

Todos con **nombre real** del usuario y **CTA a https://garser.es**.

Despliegue: `supabase functions deploy <nombre> --use-api` (Docker colgado en esta máquina).

## Diseño a implementar

1. **Un único punto de envío**: evolucionar `send-email-notification` hacia una función
   genérica `type + data` (o crear `send-email`) que centralice remitente, plantillas
   (todas vía `emailBrand.ts`) y manejo de error. Eliminar las funciones/ HTML antiguos al
   migrar cada tipo.
2. **Disparadores server-side**, no desde el cliente: triggers de BD / webhooks / las Edge
   Functions existentes (`booking-payment-webhook`, `booking-authority`…).
   ⚠️ **Coordinar con el chat**: la migración `20260710120000_chat_system_messages.sql` ya
   tiene un trigger sobre `bookings` que detecta exactamente los mismos eventos (solicitud,
   aceptación, cancelación, cambio de precio) — el mismo evento debe producir mensaje de
   chat + email sin duplicar la lógica de detección (p. ej. ampliar ese trigger para
   encolar el email vía `pg_net`/cola, o un canal común).
3. **Plantillas de Supabase Auth** (verificación, reset, magic link): personalizar con marca
   GarSer y enlaces a garser.es desde el Dashboard/CLI de Auth (no viven en el repo; documentar).
4. **Secrets**: `SMTP_USER` (remitente verificado en Brevo, ideal `no-reply@garser.es`),
   `SMTP_PASS` (api-key Brevo). Modo MOCK claro en local. No exponer secretos en el repo.
5. **Limpieza**: quitar `nodemailer` de `package.json`; eliminar HTML duplicado.
6. **📱 Calidad de las plantillas en móvil** (la mayoría de emails se abren en el teléfono):
   - El shell de `emailBrand.ts` ya es responsive (max-width 600 + meta viewport ✓); QA
     real en Gmail Android/iOS y Apple Mail: botón CTA con altura táctil ≥44px, tipografía
     ≥14px, `detailRows` sin desbordes con textos largos (motivos de rechazo, direcciones).
   - Añadir **versión text/plain** a cada envío (Brevo lo soporta con `textContent`):
     mejora entregabilidad y accesibilidad.
   - Revisar el render en **modo oscuro** de los clientes de correo (los verdes #16a34a
     sobre fondos invertidos); fijar `background` explícito en la tarjeta blanca.
   - Los CTA deben hacer deep-link a la vista concreta (p. ej. `garser.es/bookings?id=…`),
     no solo a la home — en móvil cada toque de navegación extra pierde usuarios.

## Verificación

`deno check` de cada función; disparar cada `type` (curl o `supabase functions serve`) y verificar recepción real (o log MOCK) con nombre correcto y CTA a garser.es. Flujo real: solicitud de reserva → email al jardinero; aceptación → email al cliente. Enviarte un reset de contraseña para revisar la plantilla de Auth.

## Restricciones

- Deploy siempre con `--use-api`. Invocación de funciones solo autenticada/service-role.
- Los emails nunca deben bloquear el flujo principal (patrón no-bloqueante como en `booking-payment-webhook`).
- Guarda el diseño del sistema en memoria (`.../memory/emails-sistema.md`) e indéxalo en `MEMORY.md`.
