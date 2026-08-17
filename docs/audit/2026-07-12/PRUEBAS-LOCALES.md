# Pruebas locales — pasos 8, 8B y 8C

El entorno local **ya es funcional** (edge functions, Storage y base de datos). Este guion
verifica los tres pasos antes de pasar al 9.

---

## 0. Arrancar (2 comandos)

```bash
cd "/Users/javier/Downloads/GarSer-main 4"
supabase start        # si no está ya levantado
npm run dev           # web en http://localhost:5173
```

> Si haces `supabase db reset`, los datos de prueba se borran: repite el paso 1.
> Los permisos ya **no** hay que arreglarlos a mano: van en la migración
> `20260806130000_ensure_service_role_grants.sql`.

## 1. Datos de prueba

Ya están sembrados. Si necesitas recrearlos tras un reset, avísame y te paso el script.

| Cuenta | Email | Contraseña |
|---|---|---|
| Jardinero | `jardinero.local@test.local` | `Test123456!` |
| Cliente | `cliente.local@test.local` | `Test123456!` |

El jardinero tiene **Corte de césped** activo (30 €/h, 100 m²/h), cobertura de 100 km desde
Marbella y **220 huecos** de disponibilidad en las próximas 3 semanas.

---

## 2. Pruebas de la política económica (SQL, 30 segundos)

Verifican de una vez toda la política del paso 8C. **Ya las he ejecutado y pasan**; puedes
repetirlas:

```bash
DB=$(docker ps --format '{{.Names}}' | grep supabase_db | head -1)
docker exec -i "$DB" psql -U postgres -d postgres < /tmp/test_lifecycle.sql
```

| Escenario | Resultado correcto |
|---|---|
| Cliente cancela una **pendiente** | `money_action: capture` (se le cobran los gastos) |
| Jardinero cancela una **confirmada** | `money_action: refund` + `penalty_applied: true` |
| Media del jardinero | Baja a **1.00** automáticamente |
| La reseña | 1★ · "Servicio no completado" · marcada del sistema · sin cliente |
| Un tercero cancela | **Bloqueado**: "No participas en esta reserva" |
| Cron de caducidad y de autofinalización | Funcionan |

---

## 3. Pruebas desde la web

### 3.1 · El funnel muestra jardineros
Como cliente, reserva **Corte de césped** en una dirección de Marbella, 200 m².
- ✅ Aparece "Jardinero Local" con precio **60 €** (2 h × 30 €/h) y huecos disponibles.

### 3.2 · El cliente puede cancelar *(paso 8 — antes imposible)*
En **Mis reservas** → **"Cancelar reserva"**.
- ✅ Avisa **antes** de que sus gastos de gestión **no se devuelven** (con el importe real).
- ✅ Al aceptar, la reserva pasa a **Cancelado** y el hueco se libera.

### 3.3 · El jardinero puede cancelar una confirmada *(paso 8C — antes imposible)*
Acepta una reserva y luego → **"Cancelar reserva"**.
- ✅ Avisa **antes** de la devolución al cliente y de la **1★**.
- ✅ Tras aceptar, su valoración baja y la reseña se ve como penalización de GarSer.

### 3.4 · Ventana de completado *(el bug que reportaste)*
Con una reserva confirmada **futura**:
- ✅ **NO** aparece "Servicio Completado"; sale *"Podrás cerrarla cuando termine el servicio"*
  con la fecha.
- ✅ Con una reserva ya pasada, el botón sí aparece y funciona.

### 3.5 · Autofinalización a las 24 h
```sql
update public.bookings set date = current_date - 2 where id = '<ID>';
select public.run_booking_lifecycle_maintenance();
```
- ✅ Pasa a **completed** con `auto_completed_at`, y el cliente **ya puede valorar**.

### 3.6 · Caducidad de solicitudes
```sql
update public.bookings set created_at = now() - interval '25 hours' where id = '<ID>';
select public.run_booking_lifecycle_maintenance();
```
- ✅ Pasa a **expired** sin que ningún jardinero abra su panel.

### 3.7 · Cambio de precio *(paso 8B)*
Como jardinero, propón un cambio **con motivo**.
- ✅ El cliente ve el nuevo precio, el nuevo total **y el motivo en la tarjeta** (antes solo en el chat).
- ✅ El jardinero ve, en las **tres** pantallas, el mismo texto:
  *"Tu solicitud de cambio de precio se ha enviado al cliente. Esperando su respuesta."*
- ✅ Al aceptar/rechazar, el estado y los importes se actualizan en ambos lados.

### 3.8 · Subida de fotos
En el alta de jardinero, sube una foto.
- ✅ Funciona (verificado: subida con JWT de usuario → 200).
- ⚠️ Si usas una foto **HEIC** de iPhone, puede fallar: es el hallazgo pendiente registrado
  aparte, no un fallo del entorno. Usa JPG/PNG para probar.

---

## 4. Sobre los emails en local

Los emails se envían de verdad solo si hay credenciales de Brevo en local. Sin ellas, la
función entra en **modo MOCK**: no manda el correo pero **deja el registro en los logs**, que
es suficiente para verificar que el disparo ocurre y con qué contenido.

```bash
docker logs supabase_edge_runtime_GarSer-main_4 --tail 50 | grep -i "MOCK EMAIL\|EMAIL FALLIDO"
```

---

## 5. Checklist antes del paso 9

- [ ] `npx tsc --noEmit` limpio
- [ ] `npx vitest run` → 376/376
- [ ] `npm run build` correcto
- [ ] Las 6 pruebas SQL del punto 2 en verde
- [ ] Los 8 escenarios web del punto 3 verificados
- [ ] Ningún estado se muestra "en crudo" (todos con etiqueta en español)
