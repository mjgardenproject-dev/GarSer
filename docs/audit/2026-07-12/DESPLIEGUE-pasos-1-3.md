# Runbook de despliegue a producción — pasos 1, 2 y 3 (parcial)

Commit ya hecho en la rama `fix/pre-produccion` (4f02ffd). Este runbook lo ejecutas **tú en tu terminal**, porque toca producción y necesita tus credenciales (contraseña de la BD, access token). El **orden importa**: si el front nuevo se despliega antes que la migración, el funnel se rompe (usa una vista que aún no existe).

## Qué se despliega y por qué las 3 piezas van juntas
- **Migraciones** (BD): crean la vista `public_gardener_directory`, cierran la fuga de PII y blindan `bookings`.
- **Edge functions**: `booking-authority` y `booking-payment` importan el motor de precios (`bookingQuoteCore`), que cambió (guard de palmeras) → hay que redesplegarlas o el precio del cliente no cuadrará con el del servidor. `ai-pricing-estimator` cambió el prompt (herbicida fuera).
- **Front** (Vercel): usa la vista nueva. Debe ir DESPUÉS de la migración.

---

## Paso A — Backup de seguridad (recomendado)
En el dashboard de Supabase → Database → Backups, confirma que hay un backup reciente (o créalo). Aunque no hay usuarios, es buena práctica antes de migraciones.

## Paso B — Verificar y aplicar migraciones a producción
```bash
cd "/Users/javier/Downloads/GarSer-main 4"
supabase migration list        # confirma que SOLO faltan las 2 de 20260713* en Remote
supabase db push               # aplica 20260713000000 + 20260713000001 (pedirá la DB password)
```
✅ Debe aplicar exactamente esas 2 migraciones sin error.

## Paso C — Redesplegar las edge functions afectadas
```bash
supabase functions deploy booking-authority --use-api
supabase functions deploy booking-payment --use-api
supabase functions deploy ai-pricing-estimator --use-api
```
(`--use-api` porque Docker se cuelga en esta máquina.)

## Paso D — Subir el front a main (Vercel lo despliega solo)
```bash
git checkout main
git merge fix/pre-produccion
git push origin main
```
Vercel detecta el push y despliega el front nuevo (que ya encuentra la vista creada en el paso B).

## Paso E — Verificar en producción
1. **Fuga cerrada:** con la anon key de producción,
   `curl "https://<PROJECT>.supabase.co/rest/v1/profiles?select=full_name,phone" -H "apikey: <ANON_PROD>"` → debe dar `permission denied`.
2. **Funnel sin login** en garser.es: recorrer `/reservar` hasta elegir jardinero → los jardineros deben aparecer (nombre, valoración, precio, disponibilidad).
3. **Precio de palmeras por hora** correcto (si tienes un jardinero de palmeras configurado).
4. **Fitosanitarios**: ya no aparece la opción de herbicida/malas hierbas.

## Si algo va mal
- El fallo más probable: el funnel no muestra jardineros → revisa que el paso B (vista) y el paso D (front) se completaron. La ventana entre B y D deja el funnel roto para anónimos (sin usuarios, no afecta).
- Reversión de las migraciones: no recomendada (volvería a abrir la fuga de PII). Si el front falla, prioriza completar el paso D.

---

## Pendiente tras este despliegue (siguientes pasos)
- Paso 3 restante: **fitosanitario manual vs IA** (rediseño del motor de fito, con skill experta).
- CRÍTICOS aún por hacer: **paso 4 captura diferida** (pagos), **paso 6 emails** (redeploy webhook + robustez), **paso 7 reseñas** (columnas de rating).
- Limpieza (paso 11): referencias inertes de herbicida (código muerto), etc.
