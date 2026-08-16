# GarSer — Batería de pruebas en PRODUCCIÓN (garser.es)

> **Para qué es este documento.** Es la verificación **final** que se ejecuta **una vez subidos
> todos los cambios a producción**, sobre la web real, para confirmar al 100 % que todo funciona
> y que la web está lista para recibir usuarios y dinero real.
>
> **No sustituye a las pruebas locales.** Cada paso se prueba primero en local
> (`PRUEBAS-LOCALES.md`). Esto es la red de seguridad de arriba: comprueba lo mismo, pero contra
> el entorno real, donde cambian las claves, los dominios, los secretos, el correo saliente y
> las versiones desplegadas de las funciones.
>
> **Regla de esta implementación (2026-08-16):** cada paso del plan aporta sus pruebas a este
> archivo. Cuando se implemente un paso nuevo, sus pruebas se añaden aquí traducidas a producción.

---

## Cómo usar este documento

- Se ejecuta **de arriba abajo**, en orden. El orden importa: la sección 0 verifica que lo que
  estás probando es realmente lo que hay desplegado.
- Cada prueba tiene: **qué hacer** → **✅ éxito** → **❌ si falla**.
- Marca la casilla `[ ]` solo cuando la veas con tus ojos. Una prueba "que debería funcionar"
  no cuenta.
- **Si algo falla, PARA.** No sigas encadenando pruebas sobre un sistema roto: apunta el fallo,
  avísame y lo corregimos antes de continuar.

### Regla de oro del dinero

Las pruebas se hacen **en dos vueltas**:

1. **Vuelta 1 — Stripe en modo TEST** apuntando a producción. Se prueba todo, con tarjetas de
   prueba, sin mover un euro.
2. **Vuelta 2 — Stripe en modo LIVE**, y solo la **prueba de humo** del final: **una** reserva
   real del importe mínimo posible, para confirmar cobro + email + reembolso con claves reales.

Nunca hagas las pruebas de reembolso/cancelación por primera vez en modo LIVE.

---

## Datos que rellenas una vez (y usas en todos los `curl`)

Rellena esto antes de empezar y ten la tabla a mano:

| Dato | Dónde se saca | Valor |
|---|---|---|
| `URL_SUPABASE` | Supabase → Project Settings → API → Project URL | `https://________.supabase.co` |
| `ANON_KEY` | Supabase → Project Settings → API → anon public | `________` |
| Cuenta cliente de prueba | La creas tú en garser.es | `________` |
| Cuenta jardinero de prueba | La creas y **la apruebas** desde el admin | `________` |
| Cuenta admin | La tuya | `________` |

> ⚠️ La `ANON_KEY` es **pública por diseño** (va dentro del JavaScript de la web). Que aparezca
> aquí no es una fuga: precisamente por eso las pruebas de seguridad de abajo consisten en
> comprobar que **con esa clave no se pueden sacar datos personales**.

---

## SECCIÓN 0 — Antes de probar nada: ¿es esto lo que hay desplegado?

> Esta sección existe porque ya nos ha mordido **dos veces**: los emails "estaban implementados"
> pero la función desplegada era vieja, y `booking-complete` llevaba meses sin redesplegarse.
> **Probar sin verificar la versión desplegada es perder el tiempo.**

- [ ] **0.1 — Las funciones desplegadas son las del último commit.**
  ```bash
  supabase functions list
  ```
  Compara la fecha de `UPDATED_AT` de cada función con la fecha del último commit que la toca:
  ```bash
  git log -1 --format=%ci -- supabase/functions/
  ```
  - ✅ **Éxito:** toda función tocada por la implementación tiene fecha **posterior** a su último commit.
  - ❌ **Si falla:** redespliega esa función antes de seguir:
    ```bash
    supabase functions deploy <nombre> --use-api
    ```
    (`--use-api` es obligatorio en esta máquina: sin él, el despliegue se cuelga por Docker.)

- [ ] **0.2 — Las migraciones están aplicadas en producción.**
  ```bash
  supabase migration list
  ```
  - ✅ **Éxito:** no queda ninguna migración en local sin aplicar en remoto.
  - ❌ **Si falla:** `supabase db push` (haz **backup de la BD de producción antes**).

- [ ] **0.3 — El front desplegado es el último.** En Vercel, el último deploy de `main` está en
  estado *Ready* y su commit coincide con el `git log -1` de `main`.

- [ ] **0.4 — Secretos de producción presentes.**
  ```bash
  supabase secrets list
  ```
  - ✅ **Éxito:** existen `SMTP_USER` (remitente **verificado en Brevo**, `@garser.es`),
    `SMTP_PASS`, `GOOGLE_API_KEY` (Gemini) y `GOOGLE_MAPS_API_KEY` (geocoding) **por separado**.
  - ❌ **Si falla:** si `GOOGLE_MAPS_API_KEY` falta o repite la clave de Gemini, **no aparecerá
    ningún jardinero** en el funnel. Es el fallo exacto que ya tuvimos.

- [ ] **0.5 — Backup de la base de datos de producción hecho hoy.** *(Supabase → Database → Backups.)*

---

## SECCIÓN 1 — Seguridad de los datos personales (paso 1) 🔴

- [ ] **1.1 — La fuga de PII está cerrada.**
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "URL_SUPABASE/rest/v1/profiles?select=full_name,phone,address" -H "apikey: ANON_KEY"
  ```
  - ✅ **Éxito:** `401` (o `[]`). **Nunca** filas con nombres y teléfonos.
  - ❌ **Si falla:** es un **incidente de RGPD**. Para todo y avísame.

- [ ] **1.2 — Lo mismo con los perfiles de jardinero.**
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "URL_SUPABASE/rest/v1/gardener_profiles?select=full_name,phone,address" -H "apikey: ANON_KEY"
  ```
  - ✅ **Éxito:** `401`.

- [ ] **1.3 — No-regresión: el funnel sigue mostrando jardineros.** Entra en garser.es
  **sin iniciar sesión**, recorre `/reservar` hasta la pantalla de elegir jardinero.
  - ✅ **Éxito:** aparecen jardineros con nombre y valoración. Sin pantalla en blanco ni errores
    en la consola del navegador.
  - ❌ **Si falla:** revisa 0.4 (clave de Maps) antes de sospechar de la migración.

- [ ] **1.4 — La vista pública no expone de más.**
  ```bash
  curl -s "URL_SUPABASE/rest/v1/public_gardener_directory?select=*&limit=1" -H "apikey: ANON_KEY"
  ```
  - ✅ **Éxito:** responde, y **no** hay `phone` ni dirección exacta entre los campos.

---

## SECCIÓN 2 — Blindaje de la escritura de reservas (paso 2) 🟠

- [ ] **2.1 — No se puede crear una reserva con precio inventado.** Con una reserva tuya real
  (copia su `id` desde "Mis reservas") y **el token de sesión de tu cuenta cliente**
  (DevTools → Application → Local Storage → el `access_token`):
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X PATCH "URL_SUPABASE/rest/v1/bookings?id=eq.ID_RESERVA" -H "apikey: ANON_KEY" -H "Authorization: Bearer TOKEN_CLIENTE" -H "Content-Type: application/json" -d '{"total_price": 1}'
  ```
  - ✅ **Éxito:** `401` / `403` — denegado por permisos.
  - ❌ **Si falla (`204`):** cualquiera puede cambiarse el precio. **Bloqueante absoluto.**

- [ ] **2.2 — No-regresión: se puede reservar con normalidad.** Haz una reserva completa en modo
  test hasta el pago.
  - ✅ **Éxito:** la reserva se crea y aparece en "Mis reservas".

---

## SECCIÓN 3 — Precios correctos (paso 3) 🔴

- [ ] **3.1 — Palmeras por hora cobran los extras.** Recorre el funnel de **Poda de palmeras**
  con un jardinero configurado "por hora" y activa un extra (p. ej. tratamiento fitosanitario).
  - ✅ **Éxito:** el extra **está sumado** en el presupuesto.

- [ ] **3.2 — El precio que ve el cliente y el que cobra Stripe coinciden.** Anota el total
  mostrado antes de pagar y compáralo con el importe del PaymentIntent en Stripe.
  - ✅ **Éxito:** céntimo a céntimo.

- [ ] **3.3 — Desglose cliente/jardinero coherente.** En la misma reserva, compara lo que ve el
  cliente (total) y lo que ve el jardinero (su parte, sin la comisión).
  - ✅ **Éxito:** cuadran contra `management_fee`.

> ⚠️ **Pendiente conocido, no bloqueante para salir:** la paridad de precio entre el camino
> **manual** y el de **fotos con IA** en *Servicios fitosanitarios* sigue abierta (requiere un
> refactor profundo del motor, aplazado de mutuo acuerdo). Si vas a salir con fitosanitarios
> activo, tenlo presente: el camino manual puede diferir del de fotos.

---

## SECCIÓN 4 — Dinero: cobro, captura y reembolso (pasos 4 y 5) 🔴

> Todo esto en **modo TEST** primero. Tarjeta `4242 4242 4242 4242`, cualquier fecha futura, CVC libre.

- [ ] **4.1 — El pago queda AUTORIZADO, no cobrado.** Haz una reserva y págala.
  - ✅ **Éxito:** en Stripe el PaymentIntent está en `requires_capture` (autorizado), **no**
    `succeeded`. El cliente ve la reserva como *pendiente*.

- [ ] **4.2 — Aceptar captura el dinero.** Desde el panel del jardinero, **acepta** la solicitud.
  - ✅ **Éxito:** el PaymentIntent pasa a `succeeded` por el importe de los gastos de gestión.

- [ ] **4.3 — Rechazar libera el dinero.** Con otra reserva, **rechaza** desde el jardinero.
  - ✅ **Éxito:** la autorización se libera (`canceled`). El cliente **no** ve ningún cargo.
  - ❌ **Si falla:** dinero retenido a un cliente por un servicio que nadie va a prestar.

- [ ] **4.4 — El reembolso llega de verdad.** Con una reserva ya aceptada (dinero capturado),
  **cancélala desde el jardinero**.
  - ✅ **Éxito:** en Stripe aparece un **refund** por el importe de los gastos de gestión.

- [ ] **4.5 — Sin dinero colgado.** En Stripe → Pagos, filtra por las últimas horas.
  - ✅ **Éxito:** **cero** PaymentIntents en `requires_capture` de reservas ya cerradas.
    Cada euro está capturado, liberado o devuelto. Ninguno en el limbo.

- [ ] **4.6 — El webhook no duplica.** Revisa Stripe → Desarrolladores → Webhooks → el endpoint
  de producción.
  - ✅ **Éxito:** los eventos entregados responden `200`. Ninguna reserva duplicada en la BD para
    el mismo pago.

- [ ] **4.7 — Ningún evento fallido pendiente.** En ese mismo panel, la lista de entregas fallidas.
  - ✅ **Éxito:** vacía (o solo fallos antiguos anteriores al despliegue).

---

## SECCIÓN 5 — Emails (paso 6) 🔴

> Usa **dos buzones reales distintos** (cliente y jardinero). Revisa también **spam**.

- [ ] **5.1 — Reserva pagada → email a AMBOS.**
  - ✅ **Éxito:** cliente y jardinero reciben su correo, con fecha bien formateada y **el importe
    correcto según destinatario** (el jardinero no ve la comisión como suya).

- [ ] **5.2 — Jardinero acepta → email al cliente.** ✅ llega, y su botón lleva a la reserva correcta.

- [ ] **5.3 — Jardinero rechaza → email al cliente.** ✅ llega, y el enlace **no** apunta a `/apply`.

- [ ] **5.4 — Cancelación → email a la otra parte.** Cancela como cliente ✅ le llega al jardinero.
  Cancela como jardinero ✅ le llega al cliente.

- [ ] **5.5 — El remitente es el correcto.** ✅ los correos salen del remitente `@garser.es`
  verificado en Brevo, no de una dirección personal.

- [ ] **5.6 — Ningún fallo silencioso.** Supabase → Edge Functions → Logs de
  `send-email-notification`.
  - ✅ **Éxito:** ni un solo error de SMTP ni `401` del gateway en las pruebas anteriores.
  - ❌ **Si falla con error de IP:** Brevo bloquea IPs no autorizadas; hay que desbloquearla
    desde el aviso que Brevo manda al correo de admin.

---

## SECCIÓN 6 — Reseñas y reputación (paso 7) 🔴

- [ ] **6.1 — Una reseña se ve donde se elige jardinero.** Completa una reserva, deja una reseña
  de 5★, y empieza una reserva nueva hasta la pantalla de elegir jardinero.
  - ✅ **Éxito:** ese jardinero muestra su valoración real, no "Nuevo".

- [ ] **6.2 — Un jardinero sin reseñas.** ✅ muestra "Sin valoraciones", **nunca** "5.0 (0 reseñas)".

- [ ] **6.3 — La media se recalcula.** Deja una segunda reseña de 1★.
  - ✅ **Éxito:** la media baja y el contador sube. El trigger funciona en producción.

---

## SECCIÓN 7 — Cancelaciones (paso 8) 🔴

- [ ] **7.1 — El cliente puede cancelar.** En "Mis reservas", una reserva confirmada.
  - ✅ **Éxito:** hay botón **Cancelar**; avisa claramente de que **los gastos de gestión NO se
    devuelven**; la reserva pasa a *Cancelada*.

- [ ] **7.2 — Dinero al cancelar el cliente.** ✅ los gastos de gestión **se capturan** (no hay refund).

- [ ] **7.3 — El jardinero puede cancelar una confirmada.**
  - ✅ **Éxito:** hay botón; avisa de que se devuelve el dinero **y** de la penalización de 1★.

- [ ] **7.4 — Dinero al cancelar el jardinero.** ✅ aparece el **refund** en Stripe.

- [ ] **7.5 — La penalización se registra.** ✅ el jardinero recibe **1★ a nombre de GarSer** con
  "Servicio no completado", marcada como penalización del sistema (no como reseña de un cliente).

- [ ] **7.6 — El hueco vuelve a estar libre.** Intenta reservar esa misma hora con ese jardinero.
  - ✅ **Éxito:** el hueco aparece disponible otra vez.

---

## SECCIÓN 8 — Cambio de precio (paso 8B) 🔴

- [ ] **8.1 — Propuesta → email al cliente.** Como jardinero, propón un cambio **con motivo**.
  - ✅ **Éxito:** el cliente recibe email con **nuevo precio + motivo + total resultante**.

- [ ] **8.2 — El motivo se ve en la tarjeta.** ✅ el cliente ve el motivo en "Mis reservas",
  no solo dentro del chat.

- [ ] **8.3 — El jardinero sabe en qué punto está.** ✅ ve *"Tu solicitud de cambio de precio se ha
  enviado al cliente. Esperando su respuesta."* — **el mismo texto en las tres pantallas**
  (panel, gestor de solicitudes y lista de reservas).

- [ ] **8.4 — Aceptar → email al jardinero.** ✅ llega, y **ambas** tarjetas muestran el nuevo importe.

- [ ] **8.5 — Rechazar → email al jardinero.** ✅ llega, y la reserva mantiene el precio original.

- [ ] **8.6 — Aceptar no rompe el cobro.** ✅ tras aceptar, la captura en Stripe es del importe
  correcto y no hay doble cobro.

---

## SECCIÓN 9 — Ciclo de vida de la reserva (paso 8C) 🔴

> Las caducidades dependen del reloj. Para no esperar 24 h, dispara el mantenimiento a mano
> desde **Supabase → SQL Editor**:
> ```sql
> SELECT run_booking_lifecycle_maintenance();
> ```

- [ ] **9.1 — El cron existe y está activo.** En el SQL Editor:
  ```sql
  SELECT jobname, schedule, active FROM cron.job;
  ```
  - ✅ **Éxito:** aparece el job del ciclo de vida, cada 15 minutos, `active = true`.

- [ ] **9.2 — Las solicitudes sin responder caducan.** Crea una solicitud, no la respondas y
  fuerza el mantenimiento (adelantando su fecha en la BD si hace falta).
  - ✅ **Éxito:** pasa a `expired`, **se libera la autorización de Stripe**, se libera el hueco y
    llegan los emails.

- [ ] **9.3 — No se puede completar un servicio que aún no ha ocurrido.** Reserva **futura**.
  - ✅ **Éxito:** el botón "Servicio completado" **no aparece**; el jardinero ve
    *"Podrás cerrarlo cuando termine el servicio"*.

- [ ] **9.4 — Y tampoco por API.** Llama a `booking-complete` para esa reserva futura.
  - ✅ **Éxito:** el **servidor** responde `409 service_not_finished_yet`. No basta con ocultar
    el botón: si esto falla, se cobra por adelantado un servicio no prestado.

- [ ] **9.5 — Una reserva ya pasada sí se puede completar.** ✅ el botón aparece y funciona.

- [ ] **9.6 — Auto-finalización.** Reserva pasada que nadie cierra + mantenimiento forzado.
  - ✅ **Éxito:** pasa a `completed` sola y **el cliente ya puede dejar reseña**.

- [ ] **9.7 — No-show.** Dentro de la ventana, reporta un no-show por cada parte.
  - ✅ **Éxito:** el estado y el dinero siguen la política: cliente no está → se **captura**;
    jardinero no aparece → se **devuelve** + 1★ de sistema.

- [ ] **9.8 — El estado muerto ya no existe.** ✅ `in_progress` no aparece en ninguna pantalla.

---

## SECCIÓN 10 — Funciones auxiliares seguras (paso 9) 🟠

> Para estas pruebas necesitas el **token de sesión** de una cuenta cliente real
> (DevTools → Application → Local Storage → `access_token`). Se usa como `TOKEN_CLIENTE`.

- [ ] **10.1 — El envío de correos no es un relay de phishing.** Este es el contrato retirado:
  mandar un correo con la marca GarSer a **otro usuario**, con el texto que quieras dentro.
  ```bash
  curl -s -X POST "URL_SUPABASE/functions/v1/send-email-notification" -H "apikey: ANON_KEY" -H "Authorization: Bearer TOKEN_CLIENTE" -H "Content-Type: application/json" -d '{"user_id":"OTRO_USER_ID","type":"booking_accepted","data":{"name":"Victima","serviceName":"Pago urgente","priceText":"Pincha aqui"}}'
  ```
  - ✅ **Éxito:** `400 unsupported_email_type`. Y **no llega ningún correo** a ese usuario.
  - ❌ **Si falla:** cualquiera puede mandar correos desde tu dominio → tu remitente acaba en
    listas negras y **dejan de llegar todos los emails**, también los de verdad.

- [ ] **10.2 — Un tercero no puede disparar avisos de una reserva ajena.** Con el token de una
  cuenta que **no** participa en esa reserva:
  ```bash
  curl -s -X POST "URL_SUPABASE/functions/v1/send-email-notification" -H "apikey: ANON_KEY" -H "Authorization: Bearer TOKEN_DE_UN_TERCERO" -H "Content-Type: application/json" -d '{"type":"booking_accepted","bookingId":"ID_DE_UNA_RESERVA_AJENA"}'
  ```
  - ✅ **Éxito:** `403 Unauthorized`.

- [ ] **10.3 — El alta de jardinero solo la anuncia un admin.** Con un token de cliente normal:
  ```bash
  curl -s -X POST "URL_SUPABASE/functions/v1/send-email-notification" -H "apikey: ANON_KEY" -H "Authorization: Bearer TOKEN_CLIENTE" -H "Content-Type: application/json" -d '{"user_id":"CUALQUIER_USER_ID","type":"gardener_approved","data":{"name":"x"}}'
  ```
  - ✅ **Éxito:** `403 Unauthorized`.

- [ ] **10.4 — La clave pública NO es identidad ante la IA.** Este es el agujero de coste:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "URL_SUPABASE/functions/v1/ai-pricing-estimator" -H "apikey: ANON_KEY" -H "Authorization: Bearer ANON_KEY" -H "Content-Type: application/json" -d '{"description":"","service_ids":["x"],"service_name":"Corte de cesped"}'
  ```
  - ✅ **Éxito:** `401`. La `anon key` es pública: tenerla no puede dar acceso a un servicio que
    cuesta dinero.
  - ❌ **Si falla:** tu factura de Gemini la marca un tercero, y al agotar la cuota del proyecto
    **los clientes de verdad se quedan sin poder analizar sus fotos**.

- [ ] **10.5 — El modo de auditoría de prompts está cerrado.** Multiplica por diez cada llamada:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "URL_SUPABASE/functions/v1/ai-pricing-estimator" -H "apikey: ANON_KEY" -H "Authorization: Bearer TOKEN_CLIENTE" -H "Content-Type: application/json" -d '{"description":"","mode":"weeding_prompt_quality_check","qa_runs":10}'
  ```
  - ✅ **Éxito:** `403`.

- [ ] **10.6 — La IA tiene cuota por usuario.** Con la misma cuenta, lanza más de **30 análisis
  en menos de una hora** (repite el análisis de fotos en el funnel).
  - ✅ **Éxito:** a partir del umbral el funnel muestra *"Ahora mismo no hemos podido revisar las
    fotos. Puedes intentarlo de nuevo en unos minutos."* y **deja de llamar a Gemini**.
  - Comprobación directa en **Supabase → SQL Editor**:
    ```sql
    SELECT user_id, request_count, window_started_at FROM public.ai_pricing_rate_limits;
    ```
    ✅ el contador de esa cuenta sube con cada análisis.

- [ ] **10.7 — Nadie puede manipular su propia cuota.** En el SQL Editor:
    ```sql
    SET ROLE authenticated;
    SELECT count(*) FROM public.ai_pricing_rate_limits;
    ```
  - ✅ **Éxito:** `permission denied`. Un límite que el limitado puede tocar es decorativo.

- [ ] **10.8 — No-regresión (la importante):** con sesión iniciada, un análisis de fotos normal
  en el funnel ✅ **sigue funcionando igual**, con sus medidas y su precio.
  - ❌ **Si falla:** el endurecimiento se ha llevado por delante el producto. Avísame de inmediato.

---

## SECCIÓN 11 — Limpieza y consola (pasos 10 y 11) 🟠

- [ ] **11.1 — Nada de datos personales en la consola.** En garser.es, DevTools → Consola
  (deja el filtro en *All levels*). Usa el **reset de contraseña**, escribe en el
  **autocompletado de dirección** y entra al panel del jardinero.
  - ✅ **Éxito:** no se imprime tu email, ni tu id de usuario, ni tu rol, ni lo que tecleas.
  - Nota: seguirás viendo algún `warn`/`error` si algo falla. Es deliberado: se conservan para
    poder diagnosticar incidencias de clientes. Lo que no debe aparecer son **datos personales**.

- [ ] **11.2 — La herramienta de debug no está en el admin.** Entra en **Admin → Usuarios**.
  - ✅ **Éxito:** no existe ninguna sección "DatabaseFix". Hacía escrituras de prueba reales
    contra la base de datos desde el navegador.

- [ ] **11.3 — Las rutas de debug no responden.** Entra a `garser.es/debug-roles` y `/debug-maps`.
  - ✅ **Éxito:** no cargan la herramienta.
  - ❌ **Si carga `/debug-roles`:** es capaz de **crear perfiles** en la base de datos. Bloqueante.

- [ ] **11.3b — Verifica que la variable de bypass no está puesta.** En **Vercel → Settings →
  Environment Variables**.
  - ✅ **Éxito:** `VITE_ENABLE_DEBUG_ROUTES` no existe o vale `false`. (Las rutas ya no existen en
    el código, así que esto es solo higiene: la variable ya no reabre nada.)

- [ ] **11.4 — No hay rutas fantasma con datos inventados.** ✅ `/service/:id` con su rating falso
  "4.8" ya no existe.

- [ ] **11.5 — El Monitor de Roles no inventa inconsistencias.** Entra en **Admin → Usuarios** y
  pulsa **Verificar Roles** con jardineros reales dados de alta.
  - ✅ **Éxito:** los jardineros salen como **consistentes** y **tu cuenta de admin NO aparece**
    en la lista.
  - ❌ **Si falla: NO pulses "Corregir Todas".** Antes del arreglo, ese botón degradaba a
    cliente a **todos** los jardineros y también al admin, que perdía el acceso a su propio
    panel sin forma de recuperarlo desde la web. Avísame en su lugar.

- [ ] **11.6 — Comprobación de seguridad del propio botón.** Con **un solo** jardinero de prueba,
  si aparece alguna inconsistencia legítima, pulsa **Corregir** solo en esa fila y comprueba en
  Supabase que el rol cambió **en la fila correcta**:
  ```sql
  SELECT user_id, full_name, role FROM public.profiles ORDER BY role;
  ```

- [ ] **11.7 — La pantalla con reseñas inventadas ya no existe.** Entra a
  `garser.es/service/cualquier-cosa`.
  - ✅ **Éxito:** no carga ninguna ficha de servicio.
  - ❌ **Si carga y muestra "4.8 (127 reseñas)":** son reseñas **inventadas**, escritas a mano en
    el código. Publicarlas como prueba social es engañoso para el cliente. Bloqueante.

- [ ] **11.8 — Nada se rompió con la limpieza.** Recorre por encima: home pública, funnel
  completo hasta elegir jardinero, panel de cliente, panel de jardinero y admin.
  - ✅ **Éxito:** todo funciona y la consola no muestra errores nuevos.

---

## SECCIÓN 12 — Rendimiento y navegación (paso 12) 🟡

- [ ] **12.1 — La web no descarga todo de golpe.** DevTools → Network, recarga en frío.
  - ✅ **Éxito:** varios ficheros JS (chunks), no un único bundle enorme.

- [ ] **12.2 — Una URL inventada no rompe la web.** `garser.es/esto-no-existe`.
  - ✅ **Éxito:** 404 con salida, no pantalla en blanco.

- [ ] **12.3 — Volver de un pago fallido.** En `/reserva/confirmacion`, "Elegir otro horario".
  - ✅ **Éxito:** te lleva al paso de horarios.

- [ ] **12.4 — Móvil real.** Recorre el funnel entero **desde el móvil**, no desde el simulador.
  - ✅ **Éxito:** nada descuadrado, textos legibles, botones alcanzables con el pulgar.

- [ ] **12.5 — Copy sin faltas.** ✅ "jardinería" con tilde en las páginas públicas.

---

## SECCIÓN 13 — Tareas manuales del dashboard (Fase Final · A)

- [ ] **13.1 — Plantillas de email de Auth** personalizadas con la marca GarSer
  *(Supabase → Authentication → Email Templates)*: confirmación de registro, reset de contraseña,
  magic link. **Pruébalas registrando una cuenta nueva de verdad.**

- [ ] **13.2 — Las 7 imágenes de servicios** subidas al bucket `marketing-assets`.
  - ✅ **Éxito:** ningún servicio muestra el placeholder feo en la web pública.

- [ ] **13.3 — Google Maps API key restringida** por dominio (referrer) y por API en Google Cloud,
  y **la clave histórica que quedó en el git, rotada**.
  - ✅ **Éxito:** la clave vieja ya no funciona; la nueva solo desde garser.es.

- [ ] **13.4 — La función fantasma `email-otp`** revisada y borrada de producción si está muerta.

---

## SECCIÓN 14 — Prueba de humo E2E

### Vuelta 1 — Stripe en modo TEST (recorrido completo, sin dinero real)

- [ ] **14.1** Registro de un cliente nuevo → recibe el email de confirmación.
- [ ] **14.2** Reserva completa: elegir servicio → análisis (fotos o manual) → elegir jardinero →
      elegir horario → pagar con `4242 4242 4242 4242`.
- [ ] **14.3** Llegan los emails a **cliente y jardinero**.
- [ ] **14.4** El jardinero **acepta** → email al cliente + captura en Stripe.
- [ ] **14.5** Chat entre ambos funcionando.
- [ ] **14.6** Servicio completado (con fecha pasada) → el cliente **deja una reseña**.
- [ ] **14.7** La reseña se ve en la pantalla de elegir jardinero.
- [ ] **14.8** Con otra reserva: **cancelación** → email + movimiento de dinero correcto.
- [ ] **14.9** Revisión final en Stripe: **ningún pago en el limbo** (ver 4.5).

### Vuelta 2 — Stripe en modo LIVE (una sola transacción real)

> Solo cuando **toda** la vuelta 1 esté verde. Esta la hacemos juntos.

- [ ] **14.10** Una reserva real del **importe mínimo posible**, con tarjeta real.
- [ ] **14.11** El cobro aparece correctamente en Stripe LIVE.
- [ ] **14.12** Llegan los emails reales.
- [ ] **14.13** **Reembolso** de esa transacción y confirmación de que vuelve a la tarjeta.
- [ ] **14.14** El extracto cuadra: no queda ni un céntimo retenido.

---

## Criterio de GO definitivo

La web sale a producción **solo si**:

| | Requisito |
|---|---|
| [ ] | Sección 0 completa — lo desplegado es lo último |
| [ ] | Secciones 1 y 2 verdes — **sin fuga de PII ni escritura de precios** |
| [ ] | Sección 4 verde — **ningún pago en el limbo** |
| [ ] | Sección 5 verde — los emails llegan de verdad |
| [ ] | Secciones 6 a 9 verdes — reseñas, cancelaciones, precios y ciclo de vida |
| [ ] | Sección 10 verde — nadie puede abusar del correo ni de la IA |
| [ ] | Sección 13 completa — tus tareas manuales |
| [ ] | Sección 14 vuelta 1 completa, y vuelta 2 correcta |

**Cualquier fallo en las secciones 1, 2, 4 o 5 es bloqueante: NO se sale a producción.**

---

## Si algo falla: vuelta atrás

1. **Front (Vercel):** *Deployments* → el deploy anterior → **Rollback**. Es inmediato.
2. **Edge functions:** redesplegar desde el commit anterior
   (`git checkout <commit> -- supabase/functions/<n>` y `supabase functions deploy <n> --use-api`).
3. **Migraciones:** **no se revierten solas.** Por eso el backup de 0.5 es obligatorio.
   Si una migración rompe producción, se restaura el backup o se escribe una migración correctora.
4. **Dinero a medias:** si un cliente real se queda con un cargo sin servicio, **devuélveselo a
   mano desde Stripe** antes de investigar la causa. Primero el cliente, después el bug.
