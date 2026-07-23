# Prompt 06 — Sistema de emails automáticos: completar sobre la capa de marca ya creada

> Sesión nueva, en frío. Proyecto **GarSer** (React+Vite+TS, Supabase Auth + Edge Functions Deno + Brevo). Apóyate en la skill **`supabase`** (plantillas de Auth y Edge Functions).

## Estado actual (verificado 2026-07-11) — la capa de marca YA existe

El 2026-07-10 se construyó la base (comprueba con `git log` si está commiteada):

- **`supabase/functions/_shared/emailBrand.ts`** — capa compartida de marca:
  `BRAND` (verde `#16a34a`, `site: https://garser.es`), `renderBrandedEmail()` (shell HTML
  completo: cabecera, tarjeta, CTA, pie), `detailRows()` (filas etiqueta:valor),
  `formatPrice()`, `formatBookingDate()`, `escapeHtml()` y `sendViaBrevo()` (API REST de
  Brevo con manejo de error). **Todos los emails nuevos deben usar esta capa** — no
  dupliques HTML.
- **`supabase/functions/send-email-notification/index.ts`** — ya refactorizada sobre la capa:
  tipos `gardener_approved` / `gardener_rejected`, resuelve el email por `user_id` vía
  service-role, nombre real del usuario, CTA a garser.es, modo MOCK si faltan
  `SMTP_USER`/`SMTP_PASS`. ⚠️ **PENDIENTE**: `deno check supabase/functions/send-email-notification/index.ts`
  y deploy (`supabase functions deploy send-email-notification --use-api` — Docker colgado
  en esta máquina, siempre `--use-api`).
- **`supabase/functions/booking-confirmation-email/index.ts`** — confirmación de reserva a
  cliente y jardinero, invocada desde `booking-payment-webhook/index.ts` (no bloqueante).
  **NO usa aún la capa compartida** (HTML propio duplicado): migrarla.
- `nodemailer` sigue en `package.json` pero nadie lo usa (las funciones Deno usan fetch a Brevo): eliminarlo.

**Primeros pasos de esta sesión**: `deno check` + deploy de `send-email-notification`, y migrar `booking-confirmation-email` al shell compartido.

## Casos que el sistema completo DEBE cubrir (hoy solo existen 3)

| Evento | Destinatario | Estado |
|---|---|---|
| Solicitud de jardinero aprobada / rechazada | jardinero | ✅ hecho (deploy pendiente) |
| Confirmación de reserva pagada | cliente + jardinero | 🟡 existe, sin capa de marca |
| Solicitud de jardinero **recibida** | jardinero | ❌ |
| Nueva **solicitud de reserva** recibida | jardinero | ❌ |
| Reserva **aceptada** | cliente | ❌ |
| Reserva cancelada / rechazada | ambos | ❌ |
| Cambio de precio propuesto / resuelto | cliente / jardinero | ❌ |
| Recordatorio de servicio próximo | ambos | ❌ (valorar pg_cron) |
| Mensaje de chat sin leer | destinatario | ❌ (agrupar; solo si offline; anti-spam) |
| Cuenta: verificación, reset password, bienvenida | usuario | ❌ plantillas Supabase Auth sin personalizar |

Todos con **nombre real** del usuario y **CTA a https://garser.es** (a la vista concreta: mis reservas, panel jardinero…).

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
