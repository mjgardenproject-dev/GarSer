# Pruebas locales — pasos 8, 8B y 8C

Guion de verificación para dar por cerrados los tres pasos y poder avanzar al 9 con seguridad.
Todo se prueba **en local**, con **Stripe en modo test** (nunca dinero real).

---

## 0. Preparar el entorno (una vez)

```bash
cd "/Users/javier/Downloads/GarSer-main 4"
supabase start                 # BD local
supabase db reset              # aplica TODAS las migraciones, incluidas las 3 del paso 8C
npm run dev                    # web en localhost:5173
```

Para que las edge functions respondan en local (cancelaciones, dinero y emails):

```bash
supabase functions serve booking-payment booking-complete send-email-notification --no-verify-jwt
```

> Si tu Supabase local sigue con el Storage/edge roto (ver `PROGRESO.md`), las pruebas **A**
> (base de datos) funcionan igual: son SQL puro y no dependen de esos servicios. Las pruebas
> **B** (web) necesitan las functions sirviendo.

---

## A. Ciclo de vida en base de datos (sin navegador)

Estas pruebas verifican la política económica y las caducidades. **Ya las he ejecutado yo con
resultado correcto**; se incluyen para que puedas repetirlas.

```bash
DB=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
docker exec -i "$DB" psql -U postgres -d postgres < /tmp/test_lifecycle.sql
```

Si no conservas el fichero, el guion está en el historial de la sesión. Resultado esperado:

| Escenario | Resultado correcto |
|---|---|
| Cliente cancela una solicitud **pendiente** | `money_action: capture` · actor `client` |
| Jardinero cancela una **confirmada** | `money_action: refund` · `penalty_applied: true` |
| Media del jardinero tras la penalización | **1.00 (1 reseña)** |
| La reseña creada | 1★ · "Servicio no completado" · `is_system_penalty=true` · sin cliente |
| Un tercero intenta cancelar | **Bloqueado**: "No participas en esta reserva" |
| `expire_due_booking_requests()` | Caduca las `pending` de +24 h o cuya hora ya pasó |
| `auto_complete_due_bookings()` | Cierra las `confirmed` con +24 h desde el fin del servicio |

**Cron programado** (se ejecuta solo cada 15 min):

```sql
select jobname, schedule from cron.job where jobname = 'booking-lifecycle-maintenance';
-- Para forzarlo sin esperar:
select public.run_booking_lifecycle_maintenance();
```

---

## B. Pruebas desde la web

### B1 · El cliente puede cancelar (paso 8)

1. Haz una reserva como cliente y págala (tarjeta `4242 4242 4242 4242`).
2. Ve a **Mis reservas** → botón **"Cancelar reserva"**.
3. ✅ Aparece un aviso indicando que **sus gastos de gestión no se devuelven** (con el importe real).
4. Acepta.
5. ✅ La reserva pasa a **Cancelado** y el hueco vuelve a estar libre.
6. ✅ En **Stripe (test) → Pagos**: si el jardinero aún no había aceptado, el pago pasa de
   *"Requires capture"* a **capturado** (política: si desiste el cliente, se cobra).
7. ✅ El **jardinero recibe email** de cancelación.

### B2 · El jardinero puede cancelar una confirmada (paso 8C-D0)

1. Como jardinero, acepta una reserva.
2. En el panel → **"Cancelar reserva"** (antes este botón no existía).
3. ✅ Avisa **antes** de ejecutar: se devuelve el dinero y se registra **1★**.
4. Acepta.
5. ✅ En Stripe aparece un **reembolso**.
6. ✅ El **cliente recibe email** de cancelación.
7. ✅ En el perfil del jardinero baja la valoración; la reseña se ve como **penalización de
   GarSer**, no como opinión de un cliente.

### B3 · Ventana de completado (el bug que reportaste)

1. Como jardinero, con una reserva confirmada **de dentro de 3 días**:
   ✅ **NO** aparece "Servicio Completado". En su lugar: *"Podrás cerrarla cuando termine el
   servicio (fecha y hora)"*.
2. Con una reserva **ya pasada**: ✅ el botón sí aparece y funciona.
3. **Prueba del servidor** (que no basta con ocultar el botón): llama a la API directamente
   para una reserva futura → ✅ responde `409` con `service_not_finished_yet`.

### B4 · Autofinalización a las 24 h (paso 8C-D1/D2)

1. En SQL, mueve una reserva confirmada al pasado:
   ```sql
   update public.bookings
   set date = current_date - 2
   where id = '<ID_DE_LA_RESERVA>';
   ```
2. Ejecuta `select public.run_booking_lifecycle_maintenance();`
3. ✅ La reserva pasa a **completed** con `auto_completed_at` relleno.
4. ✅ El **cliente ya puede dejar reseña** (valorar exige `completed`).

### B5 · Caducidad de solicitudes (paso 8C)

1. Crea una solicitud y envejécela:
   ```sql
   update public.bookings set created_at = now() - interval '25 hours' where id = '<ID>';
   ```
2. `select public.run_booking_lifecycle_maintenance();`
3. ✅ Pasa a **expired** sin que ningún jardinero tenga que abrir su panel
   (antes solo caducaba si el jardinero entraba, y solo las suyas).

### B6 · Cambio de precio (paso 8B)

1. Como jardinero, propón un cambio de precio **con motivo**.
2. ✅ El **cliente recibe email**: nuevo precio, **nuevo total** y **el motivo**.
3. ✅ En su tarjeta de reservas ve **el motivo** (antes solo estaba en el chat).
4. ✅ El jardinero ve, en las **tres** pantallas, el mismo texto:
   *"Tu solicitud de cambio de precio se ha enviado al cliente. Esperando su respuesta."*
5. Como cliente, **acepta** → ✅ el **jardinero recibe email** de aceptación y ambas tarjetas
   muestran el nuevo importe.
6. Repite y **rechaza** → ✅ el jardinero recibe email de rechazo y se mantiene el precio original.

### B7 · No-show

1. Con una reserva confirmada **ya pasada**, reporta la incidencia.
2. ✅ Si lo reporta el **jardinero** → `no_show_client`, se **mantiene** lo cobrado.
3. ✅ Si lo reporta el **cliente** → `no_show_gardener`, **reembolso** + 1★ al jardinero.
4. ✅ Si lo reportan ambos → `disputed` (revisión manual).
5. ✅ Antes de que el servicio termine, reportar → **error** ("el servicio no ha terminado").

---

## C. Antes de dar por cerrado

- [ ] `npx tsc --noEmit` limpio
- [ ] `npx vitest run` → 376/376
- [ ] `npm run build` correcto
- [ ] Ninguna reserva muestra un estado "en crudo" (todos tienen etiqueta en español)

## D. Al desplegar a producción (después de validar en local)

```bash
supabase db push
supabase functions deploy booking-payment booking-complete send-email-notification --use-api
supabase functions deploy booking-authority ai-pricing-estimator --use-api   # motor de precios
```

Y el front por el PR habitual.

> ⚠️ El **cron** (`pg_cron`) se crea con la migración. Si el proyecto no tuviera pg_cron
> habilitado, la migración no falla: las funciones quedan creadas y hay que programarlas desde
> fuera. Compruébalo en producción con:
> `select jobname from cron.job where jobname = 'booking-lifecycle-maintenance';`
