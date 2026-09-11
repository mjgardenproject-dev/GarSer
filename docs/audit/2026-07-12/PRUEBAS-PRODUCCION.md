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

- [ ] **3.1b — Paridad manual/fotos en palmeras.** *(Añadida el 2026-08-22: en la primera pasada
  esta prueba destapó dos fallos reales.)* Declara **la misma palmera** por los dos caminos:
  primero con fotos y después con "Prefiero introducir los datos manualmente", eligiendo la misma
  especie, banda de altura, estado y sin extras. Prueba también la **banda más alta** ("Más de X m").
  - ✅ **Éxito:** por los dos caminos aparecen **los mismos jardineros** y el precio es **idéntico**,
    y cuadra con la configuración del jardinero (base de la banda + retirada de restos si procede,
    con los gastos de gestión desglosados aparte).
  - ✅ **Éxito:** el extra de **tratamiento fitosanitario** aparece **apagado por defecto** también
    en el camino de fotos: solo se suma si tú lo enciendes.
  - ❌ **Si falla:** los jardineros desaparecen en el camino manual (fallo de casación de bandas) o
    el precio trae un recargo no pedido (extra auto-activado). Ambos ya corregidos una vez; si
    reaparecen, revisa que `booking-authority` y `booking-payment` estén redesplegados (sección 0).

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

- [ ] **12.1 — La web no descarga todo de golpe.** DevTools → Network → JS, recarga en frío
  (marca *Disable cache*).
  - ✅ **Éxito:** varios ficheros JS, y el principal ronda los **150 kB comprimidos**, no 368 kB.
    El panel de admin y el de jardinero **no** se descargan al entrar como cliente.

- [ ] **12.2 — Cada zona carga al entrar.** Con la pestaña Network abierta, entra al panel de
  jardinero y luego al de admin.
  - ✅ **Éxito:** aparece un JS nuevo al entrar en cada zona, y la pantalla se muestra sin
    quedarse en blanco más de un instante.

- [ ] **12.3 — Una URL inventada no rompe la web.** `garser.es/esto-no-existe`.
  - ✅ **Éxito:** página de error 404 con botones "Ir al inicio" y "Reservar un servicio".
  - ❌ **Si falla:** pantalla en blanco, indistinguible de una web caída. El visitante se va.

- [ ] **12.4 — Volver de un pago fallido.** Provoca un pago fallido (tarjeta de test
  `4000 0000 0000 0002`) y, en `/reserva/confirmacion`, pulsa **"Elegir otro horario"**.
  - ✅ **Éxito:** te lleva de vuelta al paso de elegir horario.
  - ❌ **Si falla (el botón no hace nada):** el cliente se queda atascado justo después de que
    le falle el pago, que es el peor momento para que algo parezca roto.

- [ ] **12.5 — Móvil real.** Recorre el funnel entero **desde el móvil**, no desde el simulador.
  - ✅ **Éxito:** nada descuadrado, textos legibles, botones alcanzables con el pulgar.

- [ ] **12.6 — Copy con tildes.** Recorre la home, `/marbella` y `/para-jardineros`.
  - ✅ **Éxito:** "jardinería", "césped", "página", "más"… todas con tilde, y las preguntas
    frecuentes con sus signos de apertura (¿…?).
  - ✅ La pestaña del navegador pone **"Servicios de jardinería en Costa del Sol | GarSer"**.

- [ ] **12.7 — Ninguna etiqueta interna a la vista.** En las páginas públicas.
  - ✅ **Éxito:** no aparece por ningún sitio "Foto de cobertura…", "Slot listo para foto real"
    ni rutas de Storage. Si falta una imagen se ve un degradado de marca, sin texto técnico.
  - Nota: esto deja de importar en cuanto completes la tarea **13.2** (subir las 7 imágenes).

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

## SECCIÓN 15 — Chat en tiempo real (fix 2026-08-17) 🟠

> Contexto: el chat no entregaba nada en vivo porque `chat_messages` y `bookings` no estaban
> en la publication `supabase_realtime` (migración `20260817150000`), la subida de imágenes
> fallaba por la policy de storage y en móvil el BottomNav tapaba el cuadro de escribir.
> Se necesitan **dos dispositivos** (o dos navegadores) con el cliente y el jardinero de una
> misma reserva logueados a la vez.

- [ ] **15.1** Con el chat abierto en ambos lados: un mensaje del cliente aparece en el móvil
      del jardinero **sin recargar ni reabrir**, en menos de ~2 segundos (y al revés).
- [ ] **15.2** Mientras uno escribe, el otro ve **"escribiendo…"** bajo el nombre; con ambos
      dentro del chat se ve **"en línea"**.
- [ ] **15.3** Ticks del emisor: reloj (enviando) → ✓ (enviado) → ✓✓ azul cuando el otro
      lo lee con el hilo abierto.
- [ ] **15.4** **En móvil**: el cuadro de escribir y el botón de enviar son accesibles; el
      menú inferior (Inicio/Reservas/Chat) queda **detrás** del chat y no se ve la página de
      fondo por debajo.
- [ ] **15.5** **Imagen por chat**: se adjunta, se envía sin error y el otro la recibe en vivo
      (antes fallaba siempre por la policy de storage).
- [ ] **15.6** Con el chat cerrado: llega un mensaje → el **badge verde** con el número de no
      leídos aparece en la barra de navegación y en la lista de chats sin recargar.
- [ ] **15.7** Propuesta de **cambio de precio** (palmeras con rango abierto): al proponerla el
      jardinero, el banner ámbar y el mensaje de sistema aparecen al cliente **en vivo**; al
      aceptar/rechazar, el jardinero lo ve al momento.
- [ ] **15.8** Corte de conexión: activar modo avión 30 s con el chat abierto, que el otro
      envíe algo, desactivarlo → sale "Reconectando…" y al volver **aparecen los mensajes
      perdidos** sin reabrir el chat.
- [ ] **15.9** Al marcar un servicio como **completado**, aparece el mensaje de sistema
      "Servicio completado: …" en el hilo de ambos.

---

## SECCIÓN 16 — Área de cliente unificada (fix 2026-08-25) 🟠

> Contexto: había **dos implementaciones distintas** de "las reservas del cliente" —la página
> `/bookings` y el bloque del inicio— con tarjetas que no se parecían ni hacían lo mismo, y
> varios botones llevaban a una lista genérica en vez de a la acción concreta. Se unifican en
> una sola tarjeta, se añade la pantalla `/valoraciones` y repetir un servicio pasa por un
> resumen previo. Se prueba con la **cuenta de cliente** salvo donde se indique.

### Tarjeta única y cancelación

- [ ] **16.1** La tarjeta de una reserva se ve **igual** en el inicio y en `/bookings`: mismo
      servicio, mismo profesional, mismo chip de estado, misma fecha y dirección.
- [ ] **16.2** En el **inicio** los importes van plegados tras "Ver detalles"; en `/bookings`
      se ven desplegados. Es la única diferencia esperada entre las dos.
- [ ] **16.3** **Cancelar** aparece en las dos pantallas para reservas pendientes y
      confirmadas, y **no** aparece en una completada.
- [ ] **16.4** Al cancelar sale el **diálogo de la app** (no el del navegador), con los gastos
      de gestión reales en el texto; Escape lo cierra y el foco arranca en "No, mantenerla".
- [ ] **16.5** Si el cobro falla al cancelar, sale el aviso rojo de que la devolución no se
      completó. La reserva **no** se da por buena en silencio.
- [ ] **16.6** Filtrando por un estado sin resultados en `/bookings` sale el mensaje "No tienes
      reservas con este estado", no una lista vacía.

### Botones que abren lo que prometen

- [ ] **16.7** "Hablar con {nombre}" abre el chat **de esa reserva** encima de la lista, sin
      cambiar de pantalla. Vale en el inicio y en `/bookings`.
- [ ] **16.8** Con el chat abierto, el **botón atrás del móvil** lo cierra y deja al cliente en
      la lista, no fuera de la página. La X también, y se puede **reabrir** después.
- [ ] **16.9** "Dejar mi valoración" abre el formulario **ahí mismo**, sobre esa reserva.
- [ ] **16.10** Tras enviar la valoración, la lista **se refresca sola** y el botón desaparece.
- [ ] **16.11** El CTA del **email de valoración** (`/bookings?review=<id>`) abre el formulario
      directamente sobre esa reserva, y el parámetro desaparece de la URL.

### Pantalla de valoraciones

- [ ] **16.12** El botón **"Reseñas" del chat** lleva al cliente a `/valoraciones` (antes iba a
      sus reservas). Con la **cuenta de jardinero** sigue llevando a su panel de reseñas.
- [ ] **16.13** `/valoraciones` está también en el menú del cliente, y **no** en el del
      jardinero ni en la barra inferior.
- [ ] **16.14** La pantalla muestra arriba lo pendiente de valorar y debajo lo escrito, con la
      nota, el texto y **la respuesta del profesional** cuando la hay.
- [ ] **16.15** Dentro de las **48 h**, "Editar" reabre la valoración, permite cambiar nota y
      texto, y al guardar se actualiza la media del profesional en su panel.
- [ ] **16.16** Pasadas 48 h la valoración se abre en **solo lectura** y no ofrece editar.

### Repetir un servicio

- [ ] **16.17** "Volver a reservar" aparece en **cualquier** servicio completado, esté valorado
      o no.
- [ ] **16.18** Al pulsarlo sale una **tarjeta de resumen** con el servicio, el profesional,
      cuándo se contrató, la dirección y el desglose del trabajo. **No** la pantalla de análisis.
- [ ] **16.19** "Continuar" está apagado hasta marcar la casilla de confirmación.
- [ ] **16.20** Tras continuar, la pantalla de detalles muestra un aviso **de una línea** (no
      vuelve a pedir la misma confirmación) y el asistente abre en **"Revisa tus datos antes de
      continuar"**, con los datos rellenos y un "Editar" por apartado.
- [ ] **16.21** El precio final **no** es el de la vez anterior: se recalcula en la pantalla de
      jardineros con las tarifas vigentes.
- [ ] **16.22** Repitiendo una reserva **antigua sin presupuesto asociado**, se pasa directo a
      rellenar los datos en vez de enseñar un resumen vacío.

### No regresión

- [ ] **16.23** Con la **cuenta de jardinero**: cancelar una reserva aceptada muestra el
      diálogo de la app con las **dos consecuencias en líneas separadas** (devolución y 1★).
- [ ] **16.24** Los estados de las reservas se leen bien en las cuatro pantallas que los
      muestran (inicio del cliente, `/bookings`, lista de chats y panel del jardinero); el
      jardinero ve "Cliente ausente"/"No acudiste" donde corresponde.

---

## SECCIÓN 17 — Corte de césped (auditoría 2026-09-11) 🔴

> Contexto: auditoría de preparación para producción del servicio de césped. Motor y flujo
> manual verificados en local con evidencia real (curl a `booking-authority` con
> `recalculate_correction`, capturas de la BD, PaymentIntents en Stripe). Veredicto **NO-GO**:
> 4 bloqueantes. Las pruebas de abajo traducen esos hallazgos a garser.es — **repítelas
> después de cada corrección**, no solo antes de salir.

### Precio y horas del motor

- [ ] **17.1 — Caso base.** Reserva manual de césped, 1000 m², estado normal, sin retirada de
  restos, con la tarifa real del jardinero que uses en producción.
  - ✅ **Éxito:** precio = `price_per_m2 × 1000`, horas = `ceil(1000/yield_m2_per_hour)` (o el
    valor que corresponda tras el ajuste de horas altas), y el precio mostrado al cliente
    coincide céntimo a céntimo con el que aparece en el panel del jardinero.

- [ ] **17.2 — Recargo de estado: precio y horas por separado.** Mismo jardín, pero
  "descuidado" y luego "muy descuidado".
  - ✅ **Éxito (precio):** sube exactamente el % que el jardinero tiene configurado en
    `condition_surcharges`.
  - ❌ **Fallo conocido, hallazgo #1 (bloqueante):** las HORAS no suben el mismo % que el
    precio — suben un 30 %/70 % fijo en vez del % configurado. Compara a mano: si el
    jardinero tiene configurado, por ejemplo, un 20 % para "descuidado", las horas deberían
    subir ~20 %, no 30 %. Si el jardinero configuró un % distinto del 20/50 por defecto, la
    diferencia es más visible que en el entorno de prueba (que coincidía por redondeo en el
    caso concreto de "descuidado").

- [ ] **17.3 — Redondeo de horas (hallazgo #4, bloqueante).** Prueba manual con una superficie
  que dé una hora "redonda" tras el ajuste de horas largas — por ejemplo, con
  `yield_m2_per_hour=150`, un jardín de **5000 m²** en estado normal (horas teóricas exactas:
  `(5000/150)·0,9 = 30,0`).
  - ✅ **Éxito:** horas mostradas = **30,0 h**.
  - ❌ **Si falla (30,5 h):** confirma el fallo de coma flotante. Prueba con la superficie/
    rendimiento reales de tu jardinero de producción — el fallo depende de la división exacta,
    así que el número que lo dispara cambia con cada configuración.

- [ ] **17.4 — Sin tope de plausibilidad en fotos (hallazgo #5, grave).** Sube fotos de un
  jardín pequeño pero, si tienes acceso de prueba al analizador, fuerza o edita una superficie
  desproporcionada (miles de m²) antes de confirmar.
  - ❌ **Si el sistema no avisa ni bloquea:** confirma que no hay red de seguridad ante una
    alucinación de la IA en la medición. No es bloqueante para salir si el resto del funnel
    funciona, pero debe quedar en el radar.

### Cambio de precio (hallazgos #2 y #3, ambos bloqueantes)

- [ ] **17.5 — El jardinero corrige la medida real y el precio sube.** Como jardinero, en una
  solicitud pendiente, usa "Recalcular con las medidas reales del jardín" con una superficie
  mayor que la declarada, y "Proponer".
  - ✅ **Éxito:** el precio propuesto coincide con lo que darías a mano con las tarifas del
    jardinero para la nueva superficie.

- [ ] **17.6 — El cliente acepta desde el INICIO (dashboard).** Con la cuenta de cliente, en la
  pantalla de inicio ("Hola de nuevo, …"), pulsa **"Aceptar nuevo precio"** directamente ahí,
  sin ir a "Ver todas".
  - ❌ **Fallo conocido:** el botón no hace nada — ni cambia el estado ni se ve ningún error.
    Confirma yendo a **"Mis reservas" → "Ver todas"**: los mismos botones, en esa pantalla, sí
    funcionan. Si en producción el dashboard sigue así, cualquier cliente que no descubra "Ver
    todas" se queda sin forma de responder a una propuesta de precio.

- [ ] **17.7 — Tras aceptar, ¿cambian las horas?** Con el cambio de 17.5 ya aceptado
  (usa "Ver todas" para que funcione), compara la duración que muestra la reserva antes y
  después.
  - ❌ **Fallo conocido:** el precio sube pero las horas y la franja horaria (inicio-fin) se
    quedan como antes de la corrección. Comprueba también si esto adelanta indebidamente el
    aviso de "¿Se hizo el trabajo?" al cliente (aparece cuando pasa `hora_inicio + horas_ANTIGUAS`,
    no las horas reales del trabajo corregido).

### Ciclo de vida (para no-regresión, ya verificado en local con evidencia)

- [ ] **17.8 — Pago, aceptación y desglose.** Reserva de césped completa hasta el pago con
  tarjeta de test. ✅ el PaymentIntent queda `requires_capture` por los gastos de gestión, y
  el desglose cliente/jardinero (total, gastos de gestión, importe al profesional) coincide
  con lo mostrado en pantalla.

- [ ] **17.9 — Cierre, reseña y repetir.** Completa el servicio, confírmalo como cliente, deja
  una reseña, y usa "Volver a reservar". ✅ la reseña se ve al elegir profesional en la
  reserva repetida, y el precio se recalcula con las tarifas vigentes (no el de la vez
  anterior).

- [ ] **17.10 — Cancelación con más de 24 h.** Cancela una reserva de césped **pendiente**
  (jardinero aún sin aceptar) programada para dentro de más de 24 h.
  - ✅ **Éxito:** el PaymentIntent queda `canceled` en Stripe (`amount_capturable: 0`), y el
    cliente ve que no se le ha cobrado nada.

---

## SECCIÓN 18 — Poda de árboles (auditoría 2026-09-11, GO) 🟢

> Traducido de `scripts/readiness/arboles.mjs` (rama `auditoria/arboles`), verificado en local
> con `READINESS_ENGINE=local` (motor en proceso) tras rebasar sobre `origin/main` —
> **15/15 PASA**. Ciclo de vida completo (reserva → pago real → cambio de precio → finalización →
> reseña → repetir, y por separado reserva → pago real → cancelación) verificado en el navegador
> contra el stack local, con evidencia en Stripe y en BD — ver el informe de la conversación del
> 2026-09-11 para el detalle línea a línea. En producción se repite por HTTP contra el
> `serviceId` real (`select id from public.services where name ilike '%árbol%'`, no asumas el de
> aquí) y con la tarifa que el jardinero real tenga configurada — los números de abajo son los de
> la config sembrada local (`formacion` 35/60/110 €, `estructural` 45/80/150 €,
> `difficultyIncrease` 30 %, `wasteRemovalMultiplier` 15 %, `minimumPrice` 60 €) y **no van a
> coincidir** salvo que configures esa misma tarifa antes de probar.

- [ ] **18.1 — Escenario base.** 2 árboles de poda estructural, tamaño grande, sin dificultad ni
      retirada. ✅ **Éxito:** precio = 2 × tarifa `estructural.large`; horas = `ceil((2 × 1/yield)
      × 2) / 2`.
- [ ] **18.2 — Mínimo.** 1 árbol de formación pequeño (por debajo del mínimo del jardinero).
      ✅ **Éxito:** factura exactamente el `minimumPrice` configurado, no el precio teórico de la
      banda.
- [ ] **18.3 — Dificultad alta.** 1 árbol estructural mediano con "Acceso difícil".
      ✅ **Éxito:** precio = tarifa de banda × (1 + `difficultyIncrease`/100). Verificado también
      con un árbol PEQUEÑO (0-3 m): el motor SÍ cobra el recargo en esa banda. **Corregido
      (2026-09-11):** el texto del panel del jardinero decía "No aplica a árboles de 0-3m" —
      decisión de negocio: el recargo aplica a todos los tamaños, y el texto ya lo refleja.
- [ ] **18.4 — Retirada de restos.** 1 árbol de formación grande con "Retirada de restos"
      activada. ✅ **Éxito:** precio = tarifa de banda × (1 + `wasteRemovalMultiplier`/100),
      redondeado al alza al euro.
- [ ] **18.5 — Árbol muy grande (>9 m).** Selecciona "Muy grande (>9 m)".
      ✅ **Éxito:** cobra el precio y usa el rendimiento de la banda "Grande", y aparece el aviso
      *"El profesional tendrá que verificar el pago porque es un servicio muy complejo"*.
- [ ] **18.6 — Fuera de rango.** Fuerza un tamaño de árbol inválido (solo posible manipulando la
      llamada, no desde la UI). ✅ **Éxito:** 422 `manual_input_invalid`, nunca un precio en 0
      silencioso.
- [ ] **18.7 — Tope de cantidad (corregido 2026-09-11).** Sube el stepper "Cantidad de árboles
      idénticos" a un valor absurdo (p. ej. 500) tras analizar/declarar un árbol.
      ✅ **Éxito:** se detiene en 20 con el aviso "Máximo 20 árboles idénticos por grupo. Para
      más, añade otro grupo o contacta directamente con el profesional." — verificado con el
      input a 500 (clamp a 20) y con el modo manual por HTTP tras desplegar (422
      `manual_input_invalid` con `treeGroups[0].quantity` fuera de rango; en local con
      `READINESS_ENGINE=local` no se observa porque el motor en proceso no pasa por la
      validación manual — ver nota en `scripts/readiness/arboles.mjs`).
- [ ] **18.8 — Paridad manual/fotos.** Declara el mismo árbol (tamaño, tipo de poda, dificultad,
      retirada) por los dos caminos. ✅ **Éxito:** mismo precio y mismas horas céntimo a céntimo
      (verificado: 240 € / 2,5 h en ambos, con `READINESS_ENGINE=local`).
- [ ] **18.9 — Configurador del jardinero.** Cambia el precio mínimo en el panel del jardinero,
      guarda, y repite el escenario 18.2 desde el lado del cliente. ✅ **Éxito:** verificado en
      vivo — `minimumPrice: 60→99`, el cliente vio `99 €` en la siguiente cotización sin recargar
      caché ni reiniciar nada.
- [ ] **18.10 — Ciclo completo con pago real.** Reserva un árbol, paga con la tarjeta de test, y
      comprueba en Stripe que el PaymentIntent llega a `requires_capture` y que `bookings` tiene
      la fila. ✅ **Éxito, verificado dos veces** con tarjeta de test real: PaymentIntents
      `pi_3UEWpZ2MwFyGXuB70eJndOHo` (13,00 €) y `pi_3UEX1z2MwFyGXuB70GOUMXJT` (7,50 €), ambos
      `requires_capture`, ambos con su `booking_id` poblado.
- [ ] **18.11 — Cambio de precio.** El jardinero recalcula con la medida real y propone un precio
      nuevo; el cliente lo acepta desde "Mis reservas" (`/bookings`, no desde el dashboard de
      inicio — ver 18.13). ✅ **Éxito en el precio**: verificado 104 €→225 € coincidiendo
      exactamente con el cálculo a mano. ❌ **Fallo transversal (T4 en
      `COORDINACION-SERVICIOS.md`, no arreglar aquí)**: `duration_hours` y `end_time` de la
      reserva NO se actualizan tras aceptar — quedan en el valor de antes del cambio.
- [ ] **18.12 — Cancelación con liberación de la retención.** Cliente cancela una reserva
      pendiente >24 h antes de la fecha, con el pago ya autorizado (no capturado) en Stripe.
      ✅ **Éxito, verificado con pago real**: `bookings.status→cancelled`, PaymentIntent
      `pi_3UEX1z2MwFyGXuB70GOUMXJT` pasa a `status: canceled` en Stripe
      (`amount_capturable=0`), "No se te ha cobrado nada" en pantalla. **No probado**: cancelar
      después de que el jardinero acepte, o después de que el pago se capture (ahí haría falta un
      `refund`, no un `cancel`).
- [ ] **18.13 — Botón "Aceptar nuevo precio" del DASHBOARD de inicio.** ❌ **Fallo transversal
      (T5, no arreglar aquí)**: no hace nada al pulsarlo — sin request, sin cambio de estado.
      Los mismos botones SÍ funcionan en "Mis reservas" → "Ver todas" (usa esa ruta en 18.11).
- [ ] **18.14 — Finalización, reseña y repetir.** Jardinero marca "He terminado" → cliente
      confirma "¿Se hizo el trabajo?" → dejar reseña → "Volver a reservar". ✅ **Éxito, ciclo
      completo verificado**: `bookings.status→completed`, reseña guardada en `reviews` (5,0,
      comentario), `rating_average`/`rating_count` del jardinero actualizados, y "Volver a
      reservar" muestra "Contratado anteriormente · 5.0 (1) ver reseñas" con el precio
      recalculado a tarifas vigentes.
- [ ] **18.15 — "Solicitudes de Reserva" del jardinero.** Antes de aceptar, comprueba dos cosas:
      ❌ **el nombre del cliente aparece como "Cliente desconocido"** siempre (hallazgo
      transversal T9, no arreglar aquí — sí aparece bien en "Mis Reservas" y en el dashboard, es
      solo esta pantalla). ❌ **La cabecera muestra `(1h)` aunque el servicio dure más**
      (transversal T6, ya conocido).
- [ ] **18.16 — Email de confirmación de reserva (cliente + jardinero) tras el pago.** ✅
      **Éxito en la creación de la reserva; ❌ fallo en el email (hallazgo transversal T11, no
      arreglar aquí).** Con el webhook de Stripe llegando de verdad, la reserva se crea
      correctamente, pero la llamada interna a `booking-confirmation-email` devuelve 401 y el
      email nunca sale — comprueba la bandeja del cliente y del jardinero tras un pago real; si
      no llega nada, confirma el hallazgo T11 antes de asumir que es un problema de SMTP/Brevo
      en producción (podría ser el mismo 401).

---

## SECCIÓN 19 — Poda de setos (auditoría 2026-09-11) 🟢

> Traducido de `scripts/readiness/setos.mjs` (rama `auditoria/setos`). Fase 2 (2026-09-11):
> NO-GO, 2 bloqueantes + 1 grave, verificados en local con `READINESS_ENGINE=local` y en el
> navegador contra el stack local con evidencia real: pago con tarjeta de test (PaymentIntent
> `pi_3UEYrf2MwFyGXuB714kx1Few`, `requires_capture`, 24,25 €), reserva persistida
> (`bookings id=1d41286d-3b54-4923-bb9e-ccea6a53dc19`), y el hallazgo #2 reproducido en vivo con
> lectura SQL antes/después. **Fase 3, mismo día, autorizada por el usuario: los 3 hallazgos
> quedaron corregidos** (motor en proceso 35/35 PASA, `tsc` 172→172 sin errores nuevos, `vitest`
> 434/434 — detalle en `docs/audit/2026-09-11-setos/REPORT.md` §9). **Los puntos de abajo siguen
> sin marcar `[ ]` porque describen la prueba EN PRODUCCIÓN, que no se puede ejecutar hasta que
> esta rama se fusione y `booking-authority` se redespliegue — no confundir "corregido en la
> rama" con "verificado en garser.es".** Los números de abajo son los de la config sembrada
> local (`pricing_matrix` 3,5/5,5/8,0 €/ml, `yield_ml_per_hour` 25/15/8 ml/h,
> `condition_surcharges` media 20 %/alta 50 %, `waste_removal` 15 %, `minimum_price` 50 €,
> `precioPorHora` 30 €) y **no van a coincidir** salvo que el jardinero real de producción tenga
> exactamente esa tarifa — recalcula a mano con la suya antes de leer ✅/❌. El `serviceId` real
> se obtiene con `select id from public.services where name ilike '%seto%'` — el de
> `references/servicios.md` (`3788349c-…`) es fantasma, no existe.

### Precio y horas del motor (hallazgo #1, bloqueante — corregido en `auditoria/setos`)

- [ ] **19.1 — Caso base.** Manual o fotos, 40 ml de seto de 0-2 m, estado normal, 1 cara, sin
  retirada. ✅ **Éxito:** precio = `pricing_matrix['0-2m'] × 40`; horas =
  `ceil((40/yield_ml_per_hour['0-2m']) × 2)/2`. Con la tarifa sembrada: 140,00 € / 2,0 h.

- [ ] **19.2 — Recargo de estado: precio y horas por separado.** Mismo seto pero "Descuidado" y
  luego "Muy descuidado".
  - ✅ **Éxito (precio):** sube exactamente el % que el jardinero tiene configurado en
    `condition_surcharges.media`/`alta`.
  - ✅ **Corregido (2026-09-11, `bookingQuoteCore.ts`, bloque `hedgeZones` de horas):** antes,
    las HORAS no subían ese mismo % — subían un 30 %/70 % fijo (`getDurationMultiplier`), no el
    `condition_surcharges` real. Con la config sembrada (`media: 20`, `alta: 50`), 40 ml/0-2m/
    Descuidado con retirada mostraba **194,00 € y 2,5 h** antes del fix; con el fix, el motor en
    proceso da **194,00 € y 2,0 h** (verificado con `READINESS_ENGINE=local`, pendiente de
    confirmar en pantalla real tras desplegar `booking-authority` — ver nota de cabecera). Con
    "Muy descuidado" + 2 caras + retirada en un tramo largo, la diferencia llegaba a 2 horas
    completas (1139,00 € / 14,5 h antes → 12,5 h con el fix). **Verificar en producción:**
    repite 19.2 con la tarifa real del jardinero — si su `condition_surcharges` no es 20/50,
    comprueba que las horas mostradas usan exactamente ese %, no un 30/70 fijo.

- [ ] **19.3 — Redondeo por encima de 8 horas (T2, transversal, ya documentado — solo
  confirmar que no ha empeorado).** Un tramo que cruce el umbral de 8 h brutas. No es un
  hallazgo nuevo de setos: no lo dupliques en `COORDINACION-SERVICIOS.md`, solo anota si lo
  ves.

### Configurador del jardinero (hallazgo #2, bloqueante — corregido en `auditoria/setos`)

- [ ] **19.4 — Abrir el configurador de setos SIN tocar nada.** Con una cuenta de jardinero que
  tenga la banda "Setos de gran altura (4-6m)" ya tarifada pero que **nunca haya usado el
  interruptor "Activar columna 4-6m"** (p. ej., la configuró antes de que ese interruptor
  existiera), entra en Mi Perfil → Servicios → Configurar "Poda de setos", y **no toques
  ningún campo**.
  - ✅ **Corregido (2026-09-11, `HedgePricingConfigurator.tsx:127-134`), reproducido en local
    antes y después con evidencia SQL:** antes del fix, a los ~1 segundo de abrir el panel
    aparecía el toast "Configuración guardada y servicio sincronizado" sin ninguna acción del
    jardinero, y la banda 4-6m quedaba vacía en BD (`pricing_matrix['4-6m']` → `""`). Con el
    fix, el mismo gesto (abrir sin tocar nada) deja el interruptor en "Activado" y conserva
    `pricing_matrix['4-6m']`/`yield_ml_per_hour['4-6m']` — verificado con lectura SQL
    antes/después, ver `docs/audit/2026-09-11-setos/REPORT.md` §9.2. **Verificar en
    producción:** el mismo gesto (abrir sin tocar nada) con un jardinero real que tenga 4-6m
    tarifado y el flag ausente — comprobar con SQL que la banda sigue intacta después.
  - **Impacto real que evita el fix:** antes, cualquier jardinero de producción que configuró
    setos altos antes de que existiera el interruptor perdía esa banda de precio la próxima vez
    que abría su propio panel de ajustes, sin ninguna acción explícita ni aviso.

### Plausibilidad (hallazgo #3, grave — corregido en `auditoria/setos`)

- [ ] **19.5 — Seto desproporcionado por fotos.** Fuerza (o edita tras el análisis) una longitud
  de varios cientos de metros en el flujo de fotos.
  - ✅ **Corregido (2026-09-11, `bookingQuoteCore.ts`, bloque `hedgeZones` de horas):** nuevo
    `pushWarning('hedge_length_implausible', …)` cuando la longitud supera 200 ml (SSOT
    `HEDGE_MAX_PLAUSIBLE_LENGTH_M`), mismo patrón que `lawn_area_implausible` de césped.
    Verificado con `READINESS_ENGINE=local`: 300 ml ahora trae el warning; antes facturaba
    1650 €/18 h sin ningún aviso. **Verificar en producción:** una longitud >200 ml debe traer
    el aviso en la respuesta de `booking-authority` (campo `warnings`).

### Ciclo de vida (para no-regresión, ya verificado en local con evidencia)

- [ ] **19.6 — Pago y desglose.** Reserva de setos completa (manual, 40 ml/0-2m/Descuidado/1
  cara/con retirada) hasta el pago con tarjeta de test. ✅ **Éxito, verificado con pago real**:
  PaymentIntent `pi_3UEYrf2MwFyGXuB714kx1Few` queda `requires_capture` por 24,25 € (los gastos
  de gestión), y `bookings` guarda `total_price=194.00`, `management_fee=24.25`,
  `client_total_price=218.25` — coincide céntimo a céntimo con lo mostrado en pantalla.

- [ ] **19.7 — Bloqueo de calendario redondeado al alza.** Con 2,5 h de `estimatedHours`, el
  bloque de agenda reservado es de 3 h completas (`duration_hours=3`, `09:00-12:00`). Esto es
  el comportamiento esperado (`Math.max(1, Math.ceil(estimatedHours))`), no un fallo — no lo
  confundas con el hallazgo #1.

- [ ] **19.8 — Disponibilidad y cobertura.** Un jardinero sin huecos en domingo no debe
  ofrecer horas ese día; una dirección fuera de su radio no debe verlo en el listado. ✅
  **Verificado por HTTP en local** (`valid_hours` domingo → `[]` con `no_reservable_availability`;
  `preview_providers` fuera de cobertura → excluido con `outside_coverage`).

- [ ] **19.9 — Cambio de precio, cancelación, finalización y reseña.** **No ejecutado para
  setos en esta auditoría** — son los mismos componentes genéricos (`ClientBookingLauncher`,
  `BookingsList`, `respond_booking_price_change`, `BookingRequestsManager`) ya verificados y
  documentados como hallazgos transversales T4/T5/T6/T9/T11 por las auditorías de césped y
  árboles (ver SECCIONES 17-18 arriba). Si los repites para setos, es de esperar que reproduzcan
  los mismos síntomas — no lo cuentes como hallazgo nuevo de setos si es así.

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
| [ ] | Sección 16 verde — el área de cliente unificada |
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
