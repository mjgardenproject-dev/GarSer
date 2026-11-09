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
  primero con fotos y después con la opción "Escribo los datos" del selector de la parte
  superior del paso 3 *(hasta 2026-09-20 se llamaba "Prefiero introducir los datos manualmente")*, eligiendo la misma
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

## Sección 20 — Ronda transversal (T1–T12, turno 2, 2026-09-14)

> Los hallazgos T1–T12 de `COORDINACION-SERVICIOS.md` §3.2 son transversales: no son de un
> servicio concreto, así que estas pruebas valen para cualquier servicio en el que las
> ejecutes. Todo lo de aquí abajo está **verificado en local** (7 servicios, Fases 1-7 del
> turno 2, `docs/audit/2026-09-09-transversal/PLAN-IMPLEMENTACION-TURNO2.md`) — falta
> confirmarlo contra producción tras el deploy.

- [ ] **20.1 — Puerta de licencia fitosanitaria (T1).** Con un jardinero sin licencia vigente
  (sin fecha de caducidad futura aprobada), un trabajo de fitosanitarios químico o de desbroce
  con herbicida no debe listarlo como profesional disponible; palmeras SÍ debe listarlo (no
  entra en esta puerta, D2). ✅ **Éxito**: `preview_providers` devuelve el jardinero excluido
  con `missing_phytosanitary_license` en los dos primeros casos, y elegible en palmeras. ❌ Si
  falla: revisa `hasValidPhytosanitaryLicense()` en `bookingEligibilityCore.ts` y que la
  licencia realmente no tenga `license_expires_at` futura en BD.

- [ ] **20.2 — Redondeo de horas por coma flotante (T2).** Un trabajo cuya `(cantidad/yield)*0.9`
  cruce el umbral de 8h con un residuo binario (p. ej. céspedes de 5000 m² o 1250 m²) no debe
  facturar 0,5h de más. ✅ **Éxito**: `estimatedHours` sale exacto (30.0, 7.5, 15.0 según el
  caso), no 30.5/8.0/15.5. ❌ Si falla: revisa que `Math.round(totalHours * 1e6) / 1e6` siga
  aplicándose justo antes del `Math.ceil` en `bookingQuoteCore.ts`.

- [ ] **20.3 — Cambio de precio con cambio de duración (T4/D5).** El jardinero propone un
  nuevo precio y, opcionalmente, una nueva duración (solo mueve la hora de FIN) sobre una
  reserva `pending`. Al aceptar el cliente, la agenda debe redimensionarse sin dejar huecos ni
  solapes. ✅ **Éxito**: `bookings.duration_hours`/`end_time` cambian, y `booking_blocks` +
  `availability_blocks` + `availability` reflejan el nuevo rango. ❌ Si falla: revisa
  `resize_booking_schedule()` — debe fallar entero (transacción atómica) si el alargue choca
  con horas ya ocupadas de otro cliente.

- [ ] **20.4 — Aceptar/rechazar cambio de precio desde el dashboard (T5).** Desde el dashboard
  principal del cliente (`/`, "Hola de nuevo"), no solo desde "Mis reservas", los botones
  "Aceptar nuevo precio"/"Rechazar" de una tarjeta con propuesta pendiente deben funcionar. ✅
  **Éxito**: al aceptar, la reserva pasa a `confirmed` con el precio/duración nuevos; al
  rechazar, se cancela. ❌ Si falla: revisa `cardHandlers` en `ClientBookingLauncher.tsx`.

- [ ] **20.5 — Duración correcta en el panel del jardinero (T6).** La cabecera de cada
  solicitud pendiente ("Solicitudes de Reserva") debe mostrar la MISMA duración que el
  detalle de abajo ("Duración estimada: Xh"), no siempre "(1h)". ✅ **Éxito**: ambas cifras
  coinciden para cualquier duración. ❌ Si falla: revisa que `BookingRequestsManager.tsx` lea
  `request.duration_hours` en la cabecera, no `.length` de un array sintético.

- [ ] **20.6 — Aviso honesto cuando el trabajo no cabe en un día (T7).** Un trabajo cuya
  duración estimada supere las 12h (p. ej. un césped de varios miles de m²) no debe agotar la
  ventana de 14 días sin decir por qué. ✅ **Éxito**: mensaje "Este trabajo necesita X horas
  seguidas y ningún servicio se puede reservar por más de 12 horas en un solo día..." — sin
  llegar a mirar la agenda de ningún profesional (`quotes: {}` en la respuesta cruda). ❌ Si
  falla: revisa `MAX_SINGLE_DAY_DURATION_HOURS` y la exclusión `service_exceeds_single_day` en
  `bookingEligibilityCore.ts`.

- [ ] **20.7 — Rama que falta en el sondeo de pago agotado (T8).** Si el sondeo del cliente
  tras pagar agota sus intentos sin que el webhook haya confirmado el `PaymentIntent`, el
  cliente no debe quedarse en una pantalla de carga infinita. **NO PROBADO en vivo en local**
  (requiere forzar >12s de latencia real de Stripe) — confirmar en producción con cuidado, o
  dejar constancia explícita de que sigue sin poder probarse ahí tampoco.

- [ ] **20.8 — Nombre real del cliente en las solicitudes (T9).** El panel de solicitudes del
  jardinero debe mostrar el nombre real del cliente, no "Cliente desconocido". ✅ **Éxito**:
  aparece el nombre. ❌ Si falla: revisa que `BookingRequestsManager.tsx` filtre `profiles`
  por `user_id`, no por `id`.

- [ ] **20.9 — Horario con fracción de hora bien formateado (T10).** Tras elegir hora, con una
  duración fraccionaria (p. ej. 1.5h, 2.5h, 7.5h), el texto "Horario del trabajo: HH:MM –
  HH:MM" debe mostrar minutos reales (15:30), no la fracción pegada al literal (15.5:00). ✅
  **Éxito**: formato correcto. ❌ Si falla: revisa `addHoursToTime()` en `ProvidersPage.tsx`.

- [ ] **20.10 — Emails transaccionales por webhook (T11).** Tras un pago real: (a) el email de
  confirmación de reserva debe intentar enviarse de verdad (no morir en un 401 silencioso); lo
  mismo para (b) el aviso al cliente de que el jardinero terminó, y (c) los avisos de
  cancelación e incidencia resuelta. ✅ **Éxito**: en Mailpit/el proveedor de email real
  configurado, llega el mensaje (o, si SMTP no está configurado, el log del servidor muestra
  el intento de envío, no un error de autorización). **Verificado en vivo de principio a fin
  en local solo para (a)**; (b) y (c) comparten el mismo fix pero no se dispararon en vivo por
  alcance de tiempo — si fallan en producción, revisa que las 4 llamadas a
  `admin.functions.invoke(...)` lleven `headers: { Authorization: Bearer <service_role_key> }`
  explícito (no basta con que el cliente se haya creado con la clave de servicio).

- [ ] **20.11 — Configuradores de precio sin `pricing_method` en BD (T12).** El panel de
  precios del jardinero para césped, setos y arbustos (Lawn/Hedge/Shrub) debe mostrar todos
  sus campos de tarifa aunque al perfil le falte la clave `pricing_method` guardada. ✅
  **Éxito**: se ven los campos de tarifa por categoría. ❌ Si falla: revisa que el
  configurador use `getPricingMethod()` (la SSOT), no `config.pricing_method` en crudo.

### Ciclo de vida completo (para no-regresión, ya verificado en local con evidencia real)

- [ ] **20.12 — Booking + pago real en los 7 servicios.** Cada uno de los 7 servicios debe
  completar una reserva manual + pago con tarjeta de test de principio a fin. ✅ **Verificado
  en local con pago real en los 7** (césped, árboles, arbustos, desbroce, fitosanitarios,
  palmeras, setos) — PaymentIntents reales, webhook `200 OK`, reserva creada en `pending`.

- [ ] **20.13 — Ciclo completo (aceptación+captura, cambio de precio, cancelación en ambos
  estados+reembolso, cierre+reseña).** **Verificado en local a fondo solo en césped** (los
  otros 6 servicios comparten el mismo mecanismo transversal, sin código específico de
  servicio en estos pasos, así que no se repitió 6 veces más): aceptación del jardinero
  captura el pago (`payment_intent.succeeded`/`charge.captured`); cancelación del cliente con
  <24h de antelación captura el pago igualmente (política de negocio §8C-D3, no un bug —
  cancelar con ≥24h sí libera sin coste); cancelación del jardinero tras aceptar reembolsa de
  verdad y penaliza con 1★ automática; cierre + reseña quedan registrados. Si repites esto en
  otro servicio en producción, es de esperar que reproduzca el mismo comportamiento — no lo
  cuentes como hallazgo nuevo de ese servicio si es así.

---

## Sección 21 — Formularios manuales de «Detalles» (ronda UX 2026-09-30)

> Rediseño de los 7 formularios de entrada manual (`docs/audit/2026-09-30-formularios-manuales-ux/`).
> Solo cambia la interfaz: lo que llega al motor de precios es idéntico (verificado en local con
> 88 respuestas de referencia, el banco de pruebas y la app real frente a `main`). Hazlo **desde el
> móvil**, en una ventana privada, en https://garser.es/reservar → dirección → servicio → «Detalles»
> → «Escribo los datos».
>
> **Antes del despliegue (5 min):** con las mismas respuestas de 21.2, apunta el precio y las horas
> de cada profesional en «Profesionales». Después del despliegue deben salir **iguales**.

- [x] **21.1 — Lo desplegado es lo nuevo.** *(✅ 2026-10-08, Claude, en vivo)* En «Detalles», arriba sale una sola línea «Introduces los
  datos a mano · Usar fotos» y cada pregunta lleva encima «Servicio · Pregunta X de Y». ❌ Si sale la
  rejilla de tarjetas antigua: el despliegue no es el último (Vercel → Deployments).
- [x] **21.2 — Mismo precio que antes (los 7).** *(✅ 2026-10-08: césped 56,25 € · 1 h antes y después; los otros 6 sin profesionales en esa dirección antes y después — repetir con una dirección donde haya profesionales de esos servicios)* Césped 80 m² «Descuidado» con retirada · Setos 14 m,
  2,1 m, dos caras, normal · Árboles 1 mediano estructural acceso normal + 1 grande formación acceso
  difícil · Palmeras 2 canarias 4-10 m normal + 1 Washingtonia 4-12 m descuidada con acceso difícil,
  sin retirada · Arbustos 30 m² medianas · Fitosanitarios 3 árboles grandes curativo hongos ecológico ·
  Desbroce 300 m² dificultad media con herbicida, sin retirada. ✅ Precio y horas por profesional
  iguales a los apuntados antes. ❌ Cualquier diferencia: **vuelta atrás del frontend** y avísame.
- [ ] **21.3 — Teclado del iPhone y pie fijo (H-N-14).** En setos, toca «Longitud del seto»: sale el
  teclado numérico con coma y los botones «Atrás / Siguiente» siguen a la vista o aparecen al cerrar
  el teclado, sin tapar el campo. Escribe «2,5» en la altura: se acepta (no se convierte en 25).
- [x] **21.4 — Tramo de setos.** *(✅ 2026-10-08, en vivo)* Con «+» desde vacío la altura pasa por 2 m; con 2 m pone «Tramo de
  tarifa: Bajo (hasta 2 m)» y con 2,5 m «Medio (2-4 m)».
- [ ] **21.5 — Árboles: duplicar, fantasma y acceso.** (a) Tras el primer árbol, «Duplicar» crea
  «Árbol 2» igual. (b) «Añadir otro árbol» y luego «Atrás» sin contestar: la lista sigue con los
  árboles que tenías (no aparece uno vacío) y «Profesionales» cobra solo esos. (c) En «¿El acceso al
  árbol es complicado?», «Siguiente» sin elegir muestra «Elige una opción para continuar.».
- [x] **21.6 — Palmeras.** *(✅ 2026-10-08, en vivo: nombres comunes y sin acceso en 0-4 m; el aviso de cambio de especie, comprobado en local)* Nombres comunes con el latín debajo. Con «Palmera canaria» y tronco 0-4 m,
  en «¿Necesitas algo más?» no aparece «Acceso difícil». Vuelve atrás, cambia a «Palmera de molino»:
  en la altura sale «Los tramos de altura cambian con la especie…» y no deja seguir sin elegir.
- [x] **21.7 — Fitosanitarios.** *(✅ 2026-10-08, en vivo con árboles)* «Árboles» → «¿Cuántos árboles hay que tratar?» con la altura en la
  misma pantalla (menos de 3 / 3-6 / más de 6 m). «Curativo» hace aparecer «Plaga o enfermedad a
  combatir» debajo sin mover lo de arriba. En la revisión, «3 árboles». Con «Setos», la última
  pregunta dice «Supera los 2,5 m de altura».
- [ ] **21.8 — Desbroce y retirada no heredada (D-02).** En una reserva con fitosanitarios **y**
  desbroce, al llegar a desbroce la retirada sale en «Sí» (no heredada del «no aplica» de
  fitosanitarios). La pantalla final es «Opciones del servicio» con herbicida y retirada juntos.
  Escribe «2.500» en la superficie: la revisión dice «2.500 m²».
- [x] **21.9 — Arbustos.** *(✅ 2026-10-08, en vivo)* Tamaños «Pequeñas (0-1 m) · Medianas (1-2 m) · Grandes (2-3 m)», sin
  rodilla ni cintura.
- [ ] **21.10 — Revisión y casilla.** «Cambiar» en cualquier dato lleva a esa pregunta y el botón
  vuelve a la revisión con el valor nuevo. «Confirmar y continuar» no se activa sin la casilla.
- [ ] **21.11 — Declaración guardada (con sesión de cliente).** Tras confirmar, en Supabase:
  `select declared_variables from booking_manual_declarations order by created_at desc limit 1;`
  ✅ Lleva los datos que pusiste. (Tras redesplegar `booking-manual-declaration`, H-N-10, una cantidad
  de árboles fuera de rango la rechaza el servidor.)
- [ ] **21.12 — Corrección del jardinero.** En una solicitud manual pendiente, «Recalcular con las
  medidas reales del jardín»: el modal no tiene pie fijo, no tiene casilla y «Recalcular precio»
  propone un importe.
- [ ] **21.13 — Telemetría.** Tras un recorrido de árboles:
  `select context->>'stepId' from booking_funnel_events where event='booking.manual_entry_step_completed' order by created_at desc limit 3;`
  ✅ `access`, `pruning_type`, `size` (los mismos pasos que antes, en el mismo orden).
- [ ] **21.14 — Entrada a «Detalles» sin parpadeo (H-N-24).** En el móvil, con una conexión
  normal: dirección → marca un servicio → «Continuar». ✅ Lo primero que ves en «Detalles» es
  «¿Cómo calculamos tu presupuesto?»; en ningún momento aparece «Fotos de tu jardín». Recarga la
  página estando en «Detalles»: ✅ como mucho un esqueleto gris un instante, y después la pantalla
  del servicio. Repite con 2 servicios distintos.
- [ ] **21.15 — Selector fotos/manual (H-N-25).** ✅ Al entrar, las dos opciones grandes y ninguna
  marcada, sin formulario ni «Continuar» debajo. Toca «Escribo los datos»: ✅ se pliegan con una
  animación a una barra arriba, «Escribo los datos» resaltado, «Con fotos» visible; debajo, la
  primera pregunta. Toca «Con fotos» en la barra: ✅ la misma barra con «Con fotos» resaltado y la
  pantalla de fotos con «Continuar». Vuelve a «Escribo los datos»: ✅ sigue en la pregunta donde lo
  dejaste. Con 2 servicios, al pasar al segundo: ✅ selector grande sin marcar otra vez.

## Sección 22 — Página para jardineros y empresas (`/para-jardineros`, rediseño 2026-10-17)

> Rediseño de la landing de captación (rama `feat/para-jardineros-rediseno`). Mensaje: app gratis
> para gestionar las reservas de tus clientes; tus clientes sin comisión; los clientes nuevos de
> GarSer pagan ellos los gastos de gestión. **Aviso aceptado por el dueño:** hasta que se implemente
> el cambio económico, el código sigue cobrando gastos de gestión a todos los clientes (también a los
> del enlace). Hazlo **desde el móvil**, en una ventana privada, en https://garser.es/para-jardineros.

- [x] **22.1 — Lo desplegado es lo nuevo.** *(✅ 2026-10-17, Claude, en vivo a 375 px tras fusionar el #50)* ✅ Titular «La app gratis para gestionar las reservas
  de tus clientes», tres frases con ✓ y el botón «Crear mi cuenta gratis» **sin hacer scroll**. ❌ Si
  sale «El portal para jardineros que te ahorra tiempo…»: el despliegue no es el último.
- [x] **22.2 — Sin fotos ni huecos vacíos.** *(✅ 2026-10-17, Claude, en vivo: 5 capturas, ningún hueco)* ✅ Ningún recuadro con degradado vacío; en su lugar, 5
  capturas de la app (Solicitudes, Horario, Mi cuenta, Reserva del cliente, Agenda del equipo). Al
  tocarlas no pasa nada.
- [ ] **22.3 — La tira de «Así funciona».** ✅ Las tres capturas se deslizan en horizontal con el
  dedo, cada una con su pie «1. Tu horario de la semana», «2. Tu enlace…», «3. Tu cliente…». En el
  ordenador salen las tres en fila, una bajo cada paso.
- [ ] **22.4 — Alta de jardinero.** *(2026-10-17, Claude, en vivo: el del hero ✅ abre «Crea tu cuenta» con Jardinero; faltan los otros dos)* Toca «Crear mi cuenta gratis» (hero, tras «Para ti es gratis…» y
  al final). ✅ Los tres abren «Crea tu cuenta» con la tarjeta **Jardinero** ya marcada.
- [ ] **22.5 — Alta de empresa.** *(2026-10-17, Claude, en vivo: «Dar de alta mi empresa» ✅ abre «Crea tu cuenta» con Empresa; falta el enlace que baja a la sección)* Toca «¿Tienes una empresa con empleados?…»: ✅ baja a la banda
  oscura de empresas con el antetítulo visible (no tapado por la cabecera). Toca «Dar de alta mi
  empresa»: ✅ «Crea tu cuenta» con la tarjeta **Empresa** marcada.
- [ ] **22.6 — Preguntas frecuentes.** ✅ 7 preguntas cerradas; al tocar una se abre su respuesta y la
  flecha gira; al tocarla otra vez se cierra.
- [x] **22.7 — SEO.** *(✅ 2026-10-17, Claude, en vivo: título correcto y JSON-LD con las 7 preguntas)* Pestaña del navegador: ✅ «Portal para jardineros gratis: reservas y clientes |
  GarSer». Ver código fuente no sirve (no hay prerender): usa DevTools → Elements → `<head>`.
- [ ] **22.8 — Enlace de las empresas.** Entra con una cuenta de **empresa aprobada** → «Mi cuenta»:
  ✅ sale la tarjeta «Enlace de reserva directo» con `garser.es/reservar/<id>` y «Copiar». Abre ese
  enlace en una ventana privada: ✅ perfil público de la empresa; «Reservar con este profesional» →
  en el paso «Profesional» ✅ solo sale esa empresa. (Con un empleado: ✅ la tarjeta **no** sale.)
- [ ] **22.9 — Textos corregidos fuera de la página.** Portada, bloque «¿Eres jardinero?»: ✅ «Tus
  clientes te reservan con tu enlace, sin comisión, y GarSer te trae clientes nuevos. Gratis para
  ti.» `/costa-del-sol`, pregunta «¿Puedo reservar si no estoy en la vivienda?»: ✅ «…El servicio se
  lo pagas directamente a él, de la manera que acordéis.»
- [ ] **22.10 — Cabecera: se ve en qué página estás.** En el móvil, la fila «RESERVAR → · MARBELLA ·
  SOY JARDINERO» va en **una sola línea** (también en un móvil pequeño), con la misma letra en los
  tres. En `/marbella` ✅ MARBELLA va rellena en verde; en `/para-jardineros` ✅ SOY JARDINERO; en la
  portada ✅ ninguna. «RESERVAR» va siempre con borde y nunca rellena. En el ordenador, la página
  actual sale subrayada.
- [ ] **22.11 — Contacto y ayuda.** Toca el botón de ayuda (bocadillo junto a «Acceder»; en el
  ordenador, «Ayuda»): ✅ baja al bloque «Contacto y ayuda» del pie. «WhatsApp +34 694 26 86 53» ✅
  abre WhatsApp con ese número; «info@garser.es» ✅ abre el correo. Mismo bloque en las 4 páginas
  públicas.
- [ ] **22.12 — Sin cobertura inventada.** En la portada, `/marbella` y `/costa-del-sol`: ✅ no sale
  ningún bloque de cobertura (ni «Cobertura orientada a la Costa del Sol», ni «Encuentra jardineros
  en tu zona», ni «Municipios… donde ya trabajamos», ni etiquetas de municipios). En el pie ✅ no sale
  «Cobertura orientativa». Bajo el pie, en el móvil, ✅ no queda una franja blanca.

## Sección 23 — Enlace de reserva de un profesional: casos límite (2026-10-17)

> La reserva que se abre desde `garser.es/reservar/<id>` → «Reservar con este profesional» queda
> ligada a ESE profesional aunque hubiera otra reserva a medias en el navegador. Si no puede hacer
> el trabajo, se dice por qué. Decisión del dueño: «Ver otros profesionales» solo cuando no cubre la
> zona o no hace el servicio; si solo le faltan huecos, se ofrecen fechas más adelante. Solo cambia
> el front (sin migraciones ni funciones). Hazlo **desde el móvil, en una ventana privada**. Hacen
> falta **dos profesionales aprobados** que cubran tu dirección de prueba (B = el del enlace, A = otro)
> y **no hace falta pagar**: todo se comprueba antes del botón de pago.

- [ ] **23.1 — Lo desplegado es lo nuevo.** Abre el enlace de B y toca «Reservar con este
  profesional». ✅ En «Dirección» sale el recuadro verde «Reserva con B» y el texto «Necesitamos tu
  dirección para comprobar que B trabaja en tu zona». ❌ Si dice «…para encontrar profesionales
  cerca de ti»: el despliegue no es el último.
- [ ] **23.2 — Una reserva a medias con otro profesional no gana al enlace.** Desde la portada (sin
  enlace) haz una reserva hasta la **confirmación** con **A** y para ahí. Abre el enlace de B →
  «Reservar con este profesional». ✅ Aviso «Tu reserva ahora es con B. Hemos guardado la dirección
  y los servicios…»; estás en «Profesionales» (paso 4) y **solo sale B**, con tu dirección y tu
  servicio. Elige hora → ✅ la confirmación dice **Profesional: B**. ❌ Si vuelves a la confirmación
  con A, o si en «Profesionales» sale A: bloqueante para la estrategia del enlace.
- [ ] **23.3 — Recargar no deshace nada.** Tras 23.2, recarga la página. ✅ Sigues con B y el aviso
  **no** vuelve a salir.
- [ ] **23.4 — Solo los servicios del profesional.** Con el enlace de un profesional que **no** tenga
  los 7 servicios: ✅ en «Servicios» solo salen los suyos, con «Solo ves los servicios que hace este
  profesional». Abajo, «Ver todos los servicios» → ✅ salen los 7 y desaparece «Reserva con B».
- [ ] **23.5 — Un servicio elegido que no hace.** Desde la portada (sin enlace) elige un servicio que
  B **no** hace y llega a «Detalles». Abre el enlace de B → reservar. ✅ Vuelves a «Servicios» con
  «No hace «…»: lo hemos quitado de tu selección».
- [ ] **23.6 — No trabaja en tu zona.** Enlace de B con una dirección fuera de su radio (otra
  provincia). ✅ En «Profesionales»: «B no trabaja en tu zona», con su radio en km, y los botones
  «Cambiar la dirección» (te lleva al paso 1) y «Ver otros profesionales» (carga la lista de todos).
- [ ] **23.7 — Sin huecos no enseña a la competencia.** Usa como B una cuenta de profesional **de
  prueba** (no la de un jardinero real) y deja su horario semanal sin ninguna hora libre (guárdalo
  vacío y comprueba en su calendario que no le quedan horas). Enlace de B, hasta «Profesionales». ✅ «B no tiene huecos para este trabajo», con las
  fechas miradas (un mes), el botón «Buscar a partir del …» y **sin** «Ver otros profesionales». Al
  tocarlo ✅ mira el mes siguiente. **Vuelve a poner el horario de B** al terminar.
- [ ] **23.8 — La reserva normal no cambia.** Desde la portada, sin enlace, hasta «Profesionales». ✅
  Salen todos los que cubren tu dirección y ningún recuadro «Reserva con…».

## Sección 24 — Lanzamiento: sin gastos de gestión para los clientes propios (2026-10-19)

> **Sustituida en parte por la sección 29 (2026-11-02).** El interruptor de Ajustes ya no existe: «sin gastos» para los clientes del enlace son ahora las reglas de comisión al 0 %. Un cliente que repite con GarSer y las visitas de un plan **ya no van a 0 €**: pagan lo que diga la configuración (por defecto, 3 %). Los pasos 24.x que esperen 0 € en esos dos casos ya no valen; vale lo de la sección 29.

> Rama `feat/sin-gastos-clientes-propios`. Sin gastos de gestión: reservas desde el enlace del
> profesional (`/reservar/<id>`), clientes con una reserva **completada** con ese profesional y las
> visitas de los planes. Lo decide el servidor al firmar el presupuesto, y solo con el interruptor
> de **Ajustes del admin** encendido. Se despliega **apagado**: con él apagado, nada cambia.
> Orden de despliegue: migraciones `20261019120000` y `20261019130000` → funciones
> `booking-authority`, `booking-payment`, `booking-confirmation-email`, `send-email-notification`
> → fusionar el PR (web). Hazlo **desde el móvil**, en una ventana privada.

**A. Con el interruptor APAGADO (justo después de desplegar)**

- [ ] **24.1 — Lo desplegado es lo nuevo.** Admin → Ajustes: ✅ sale la tarjeta «Lanzamiento: sin
  gastos de gestión para los clientes propios», con «Estado: Desactivado». ❌ Si sale «No se ha
  podido leer este ajuste»: la migración no está aplicada.
- [ ] **24.2 — Nada cambia.** Reserva desde garser.es (marketplace) hasta el resumen: ✅ en
  «Profesionales», «Pagas hoy X € de gastos de gestión»; en el resumen, «Continuar al pago» y el
  importe de Stripe. No hace falta pagar.
- [ ] **24.3 — El enlace también paga con el interruptor apagado.** Abre `garser.es/reservar/<id>`
  de un jardinero de prueba y llega al resumen: ✅ igual que 24.2, con gastos de gestión.

**B. Enciende el interruptor** (Ajustes → «Activar» → «Sí, activar»; ✅ «Estado: Activado»)

- [ ] **24.4 — Por el enlace, sin gastos.** `garser.es/reservar/<id>` → «Reservar con este
  profesional» → hasta «Profesionales»: ✅ «Total de la reserva» = precio del servicio y «Sin gastos
  de gestión · X € al profesional». Resumen: ✅ «Reservas con <nombre> desde su enlace: sin gastos
  de gestión», pie «Sin gastos de gestión · No pagas nada online» y botón **«Confirmar reserva»**
  (no «Continuar al pago»). Pulsa: ✅ sin formulario de Stripe, pantalla «Reserva enviada». En el
  panel de Stripe ✅ no hay ningún pago nuevo.
- [ ] **24.5 — El correo del cliente.** ✅ «Hemos enviado la solicitud al profesional. Esta reserva no
  tiene gastos de gestión…» y la fila «Gastos de gestión: Sin gastos de gestión». ❌ «Hemos retenido».
- [ ] **24.6 — El jardinero.** En «Solicitudes»: ✅ «Cobrarás X € · Íntegro para ti. Tu cliente no paga
  gastos de gestión.» Acepta: ✅ la reserva queda confirmada; en Stripe ✅ nada que capturar.
- [ ] **24.7 — Cliente nuevo desde garser.es sigue pagando.** Con otra cuenta que no haya completado
  nada con ese jardinero, reserva desde garser.es: ✅ con gastos de gestión, como en 24.2.
- [ ] **24.8 — Cliente que repite, CON sesión desde el principio.** Con una cuenta que ya tenga una
  reserva **completada** con ese jardinero, inicia sesión y reserva desde garser.es (sin el enlace).
  Fallo de producción del 2026-10-20 (veía 12,50 € hasta que se abría Stripe):
  - en «Profesionales» ✅ «Sin gastos de gestión · X € al profesional»;
  - al elegir día y hora ✅ la tarjeta sigue igual (❌ «Pagas hoy … de gastos de gestión»);
  - en el resumen ✅ «Ya has trabajado con <nombre>: sin gastos de gestión», pie «Sin gastos de
    gestión · No pagas nada online» y **«Confirmar reserva»**;
  - al pulsar ✅ NO se abre la hoja «Pago seguro» ni sale el formulario de Stripe: directo a
    «Reserva enviada». En el panel de Stripe ✅ ningún pago nuevo.
- [ ] **24.8b — Cliente que repite, SIN sesión hasta el resumen.** Igual que 24.8, pero sin sesión:
  en «Profesionales» ✅ todavía sale con gastos (no se le puede reconocer); en el resumen, al
  iniciar sesión, ✅ cambia solo a «Sin gastos de gestión» y «Confirmar reserva» antes de pulsar.
- [ ] **24.9 — «Reservar» limpia el borrador del enlace.** Con sesión iniciada, entra por un enlace,
  avanza hasta «Servicios» y vuelve a garser.es → «RESERVAR»: ✅ empieza de cero (sin «Reserva con
  <nombre>»), y una reserva normal ✅ lleva gastos de gestión (si el cliente no repite).
- [ ] **24.10 — Cancelar una reserva sin gastos.** «Cancelar reserva»: ✅ «Se cancelará la reserva y se
  liberará el hueco del profesional» (sin importes). En Stripe ✅ nada.
- [ ] **24.11 — Planes.** En un plan con próxima visita propuesta tras encender el interruptor: ✅ el
  correo dice «Gastos de gestión: Sin gastos de gestión» y el botón es «Confirmar la visita»; al
  confirmar, ✅ «Reserva enviada» sin Stripe.
- [ ] **24.12 — Panel del admin.** Dashboard: ✅ «Reservas sin gastos de gestión» cuenta las reservas
  exentas confirmadas o completadas; «Ingresos GarSer» no suma nada por ellas.

**C. Vuelta atrás (comprobarla una vez)**

- [ ] **24.13 — Apagar el interruptor.** Ajustes → «Desactivar» → «Sí, desactivar». Repite 24.4 con
  un presupuesto NUEVO: ✅ vuelve a llevar gastos de gestión. Las reservas ya hechas sin gastos ✅ no
  cambian. Vuelve a encenderlo al terminar.

> En local esto mismo lo comprueba `node scripts/fee-waiver/verify-fee-waiver.mjs` (29 escenarios,
> con Stripe en modo test) y `supabase/tests/fee_waiver.test.sql`.

## Sección 25 — Completar la cuenta profesional (2026-10-20)

> **Qué es.** Rama `feat/completar-cuenta-profesional`. En el inicio del panel, el jardinero y la
> empresa ven qué les falta para aparecer a los clientes. Lo calcula el servidor
> (`my_provider_setup_status`) con las mismas reglas que «Profesionales»:
> - tarifa activa;
> - zona con ubicación;
> - horas libres en 14 días;
> - carnet para los químicos;
> - en empresa, además, quién trabaja, qué hace cada uno y su horario.
>
> El admin tiene la sección «Profesionales». La foto de «Mi cuenta» ya es la que ven los clientes.
>
> **Despliegue:** migración `20261020120000` → fusionar el PR. No toca funciones.
>
> **Antes de empezar:** cuentas de prueba, desde el móvil y en una ventana privada:
> - un **jardinero recién aprobado**;
> - una **empresa recién aprobada**.

**A. Jardinero**

- [ ] **25.1 — Recién aprobado.** En el inicio del panel, debajo de los botones, ✅ «Completa tu cuenta
  profesional»:
  - «Todavía no apareces a los clientes» y «0 de 3»;
  - el primer paso, «Servicios y precios», con el botón «Configurar servicios».
- [ ] **25.2 — Cada botón lleva a su sitio:**
  - «Configurar servicios» → Mi Perfil, pestaña «Servicios»;
  - «Configurar zona» → «Cobertura»;
  - «Crear horario» → Horario, pestaña **«Horario fijo»**.
- [ ] **25.3 — Avanza solo.** Activa un servicio con precios, guarda la zona y crea el horario. Al volver
  al panel, cada paso sale ✅ con su resumen:
  - «1 servicio activo: …»;
  - «Hasta 25 km desde …»;
  - «X horas libres en los próximos 14 días».
- [ ] **25.4 — Sale de verdad.** Con todo hecho, ✅ la tarjeta pasa a verde «Ya apareces a los clientes». En
  otra ventana privada, reserva ese servicio en su zona y ✅ sale en «Profesionales».
- [ ] **25.5 — Compartir y cerrar.** «Compartir enlace» ✅ abre el menú del móvil (o copia el enlace
  `garser.es/reservar/<id>`), con «sin gastos de gestión» si el interruptor está encendido. Pulsa la ✕:
  - ✅ desaparece;
  - ✅ al recargar sigue sin salir.
- [ ] **25.6 — Vuelve si algo se rompe.** Deja el horario sin horas libres. Al volver al panel ✅ vuelve la
  lista completa con «Horario: No tienes horas libres… Abrir más horas». **Vuelve a poner el horario.**
- [ ] **25.7 — Carnet (solo si ofrece fitosanitarios).** Sin carnet:
  - ✅ «Carnet fitosanitario: Súbelo… Sin él solo apareces en los ecológicos»;
  - con el carnet subido, ✅ «GarSer lo está revisando».
- [ ] **25.8 — Foto.** Sube una foto en «Mi cuenta»:
  - ✅ el paso recomendado «Foto de perfil» sale hecho;
  - ✅ un cliente la ve junto a su nombre en «Profesionales» (antes no la veía nunca).

**B. Empresa**

- [ ] **25.9 — Recién aprobada.** En «Agenda», arriba, ✅ el apartado, con sus pasos propios:
  - «Quién hace los trabajos»;
  - «Servicios de cada persona»;
  - «Horario del equipo»;
  - y «Carnets fitosanitarios», si ofrece fitosanitarios.
  Los que dependen de otro ✅ salen con candado: «Primero…».
- [ ] **25.10 — Equipo.** «Ir a Equipo» → pestaña «Equipo». Activa «Yo también trabajo» y asígnate un
  servicio. Al volver a «Agenda» ✅ «Quién hace los trabajos: 1 persona trabaja: tú».
- [ ] **25.11 — Horario del equipo.**
  - ✅ «Sin horas libres: tú (sin horario)».
  - «Abrir mi horario» → ✅ `/empresa/horario?tab=recurring`, en «Horario fijo».
  - Si es un empleado: ✅ «Horario de Ana», que lleva a su horario.
- [ ] **25.12 — Servicio sin nadie.** Ofrece un servicio que no hace nadie: ✅ «Nadie de tu equipo hace
  X. Asígnalo a alguien.» y ✅ «Ya apareces en …» solo con los que sí se pueden reservar.

**C. Admin**

- [ ] **25.13 — Profesionales.** Admin → «Profesionales»:
  - ✅ «N aprobados · X aparecen · Y todavía no»;
  - con «No aparecen» seleccionado;
  - el jardinero o la empresa de prueba, con «Le falta: …», «Llamar» y «Escribir»;
  - en «Ver pasos», los mismos pasos que ve él.
  En el Dashboard, ✅ la tarjeta «Profesionales sin aparecer» lleva aquí.

> En local esto mismo lo comprueban:
> - `node scripts/provider-setup/verify-provider-setup.mjs` (26 escenarios): en cada uno, lo que dice el
>   apartado coincide con lo que de verdad enseña «Profesionales»;
> - `supabase/tests/provider_setup_status.test.sql`.

## Sección 26 — Marketing del profesional (2026-10-20)

> **Qué es.** Rama `feat/marketing-profesional`. En el panel del jardinero (botón «Marketing») y en el
> de la empresa (pestaña «Marketing»), cada profesional se hace sus materiales con su QR y la marca de
> GarSer:
> - su QR y su enlace;
> - el flyer para redes, en 4 tamaños;
> - para imprimir: tarjetas de visita, tarjeta «Próxima visita», flyer para buzonear, vinilo para la
>   furgoneta, cartel con pestañas, pegatinas con QR y cartel para la valla;
> - mensajes para WhatsApp e ideas para promocionarse.
>
> Las imágenes se dibujan en el móvil y no se guardan en ningún sitio. Solo se apunta qué se descarga,
> para el admin.
>
> **Despliegue:** migración `20261020130000` → fusionar el PR. No toca funciones.
>
> **Antes de empezar:**
> - el jardinero y la empresa de prueba de la sección 25, ya apareciendo a los clientes;
> - el móvil (iPhone y, si puedes, Android) con WhatsApp e Instagram instalados;
> - una impresora.

**A. Se ve y anima**

- [ ] **26.1 — Jardinero.** Panel → botón «Marketing». ✅ Arriba, «Date a conocer y consigue más
  reservas…». Si el interruptor de «Sin gastos de gestión» está encendido, además ✅ «Tus clientes
  reservan sin gastos de gestión».
- [ ] **26.2 — Empresa.** Pestaña «Marketing». ✅ Las 4 pestañas caben en una línea en el móvil. ✅ Los
  textos dicen «con vosotros».
- [ ] **26.3 — Sin aparecer a los clientes.** Con una cuenta que todavía no aparece (sin horario, por
  ejemplo):
  - ✅ se ven las vistas previas;
  - ✅ «Descargar QR» y «Compartir o descargar» están desactivados;
  - ✅ «Completar mi cuenta» lleva al inicio del panel, donde están los pasos que faltan.
- [ ] **26.4 — Solo lo que ofrece.** En el flyer y en las tarjetas ✅ solo salen los servicios en los
  que aparece a los clientes. ✅ Nunca salen precios, teléfono ni la dirección.

**B. Compartir y descargar desde el móvil**

- [ ] **26.5 — Flyer a Instagram.** «Flyer para redes» → «Compartir o descargar» → marca «Vertical» e
  «Historia» → «Compartir». ✅ Se abre el menú del móvil con **las 2 imágenes**. Súbelas a Instagram
  (publicación e historia). ✅ Se ven nítidas, sin cortes, con el logo de GarSer.
- [ ] **26.6 — Texto de la publicación.** «Copiar texto para la publicación» y pégalo en Instagram. ✅
  Lleva el enlace `https://garser.es/reservar/<id>?utm_source=instagram`.
- [ ] **26.7 — Estado de WhatsApp.** Comparte la «Historia» a tu estado de WhatsApp. ✅ Ocupa toda la
  pantalla sin bandas.
- [ ] **26.8 — Mensajes para clientes.** En «Mensajes para tus clientes», «WhatsApp» en «Ya puedes
  reservar online». ✅ WhatsApp se abre para elegir el contacto, con el texto y el enlace. Mándatelo y
  ábrelo: ✅ lleva al perfil del profesional con la reserva ligada a él.
- [ ] **26.9 — QR suelto.** «Descargar QR». ✅ Se guarda un PNG cuadrado con el QR, el nombre y
  «Reserva en garser.es».

**C. Imprimir y escanear**

- [ ] **26.10 — Hoja de tarjetas.** «Tarjetas de visita» → «Hoja A4 con 10» → descargar. Imprime al
  **100 % (tamaño real)**, no «ajustar a la página». ✅ Cada tarjeta mide 8,5 × 5,5 cm (con una regla).
  ✅ Las marcas de corte quedan en los bordes.
- [ ] **26.11 — Escanear el papel.** Con la cámara de otro móvil, escanea **3 tarjetas distintas** de la
  hoja impresa. ✅ Todas abren `garser.es/reservar/<id>` del profesional y se puede reservar con él.
- [ ] **26.12 — Pegatinas y pestañas.** Imprime la hoja de pegatinas y el cartel con pestañas. ✅ Los
  QR pequeños (pegatina y pestaña) también se escanean desde el papel.
- [ ] **26.13 — Vinilo.** Descarga el vinilo «Lateral». ✅ El PNG mide 3937 × 1969 (100 × 50 cm a 100
  ppp) y el logo y el QR se ven nítidos al ampliar. No hace falta imprimirlo.

**D. Admin**

- [ ] **26.14 — Profesionales.** Admin → «Profesionales» → el jardinero de prueba. ✅ «Marketing: …»
  con los materiales que ha descargado y «hoy». Un profesional que no ha descargado nada: ✅
  «Marketing: todavía no ha descargado nada».

> En local esto mismo lo comprueban:
> - `supabase/tests/marketing_downloads.test.sql`: solo el profesional apunta lo suyo, nadie lee la
>   tabla y el admin ve el resumen;
> - los tests de `src/utils/marketing` y `src/components/marketing`: medidas, que nada se salga ni se
>   pise en ningún material ni tamaño, y que los textos no lleven precios ni teléfono.
> - En el navegador se leyó el QR de los 32 materiales y tamaños (y de cada tarjeta y pegatina de las
>   hojas): todos llevan a `https://garser.es/reservar/<id>?utm_source=<material>`.

## Sección 27 — Carnet fitosanitario de los empleados (2026-10-20)

> **Qué es.** Rama `feat/carnet-empleados`. El carnet es de cada persona (D4).
>
> **Quién puede enviarlo:**
> - el propio empleado, desde «Mi trabajo»;
> - o, con su permiso, el dueño de la empresa desde la ficha del equipo (decisión del usuario).
>
> **Lo que cambia:**
> - El envío pasa por el servidor, que comprueba quién lo envía y para quién, que el archivo es suyo, la declaración responsable y un máximo de 5 envíos al día.
> - Renovar ya no quita el carnet vigente.
> - El rechazo lleva motivo.
> - Avisos por correo y en el móvil: revisión, «tu empresa te lo pide», «tu empresa lo ha enviado», 30 días antes de caducar y al caducar.
>
> **Despliegue, todo seguido:**
> 1. Migración `20261020140000`.
> 2. `supabase functions deploy send-email-notification --use-api`.
> 3. Fusionar el PR.
>
> Entre el paso 1 y el 3, la web antigua no puede subir carnets ni rechazar sin motivo.
>
> **Antes de empezar:**
> - la empresa de prueba, con «Servicios fitosanitarios» activo;
> - un empleado sin carnet;
> - el admin;
> - el móvil del empleado con los avisos activados.

**A. El empleado lo sube**

- [ ] **27.1 — Aviso en «Hoy».** El empleado entra en «Mi trabajo». ✅ Arriba sale «Sube tu carnet fitosanitario» con el botón «Subir mi carnet». ✅ El botón lleva a «Perfil», directo al carnet.
- [ ] **27.2 — Con la cámara.** «Hacer foto» abre la cámara trasera. Haz la foto de delante y, con «Foto de detrás», la de detrás. ✅ Se ven las dos con «Delante» y «Detrás».
- [ ] **27.3 — Enviar.** Sin marcar la declaración, ✅ «Enviar a revisión» está desactivado. Márcala y envía. ✅ «Carnet enviado. Te avisaremos cuando esté revisado.» ✅ El carnet queda arriba con «En revisión» y el aviso de «Hoy» desaparece.
- [ ] **27.4 — Un PDF.** Con otra cuenta, «Elegir archivo» y un PDF. ✅ Se envía igual. Un archivo que no sea foto ni PDF: ✅ «Ese archivo no vale…».

**B. La empresa**

- [ ] **27.5 — Lo ve sin ver el documento.** Empresa → «Equipo» → la persona. ✅ «Carnet fitosanitario · En revisión · Enviado el …». No hay forma de abrir el documento.
- [ ] **27.6 — Pedírselo.** Con un empleado sin carnet, «Pedírselo». ✅ «Le hemos avisado…», el botón pasa a «Pedido» y sale «Se lo pediste hoy». ✅ Al empleado le llega el correo «… te pide tu carnet fitosanitario» y el aviso en el móvil.
- [ ] **27.7 — Enviarlo por él.** «Subir su carnet» abre una hoja con «Carnet de …». Sube una foto y acepta la declaración («…tengo su permiso para enviarlo»). ✅ Queda «En revisión». ✅ Al empleado le llega «… ha enviado tu carnet fitosanitario a GarSer».
- [ ] **27.8 — Sin carnet aprobado no hay fitosanitarios.** En «Servicios» de esa persona, ✅ «Servicios fitosanitarios» no se puede marcar y dice «pídeselo o súbelo tú».

**C. El admin**

- [ ] **27.9 — La cola.** Admin → «Certificados Fito.». ✅ Cada carnet dice de quién es: «Autónomo», «Titular de…» o «Empleado de…». Y según el caso, ✅ «Lo envió su empresa», «Renovación · el actual vale hasta…» o «Rechazado N veces antes».
- [ ] **27.10 — Ver el documento.** «Revisar». ✅ Se ve la foto (las dos caras en una). En un PDF, ✅ «Abrir el documento en otra pestaña» lo abre también desde el móvil.
- [ ] **27.11 — Rechazar con motivo.** Sin motivo, ✅ «Rechazar» está desactivado. Elige un motivo rápido y rechaza. ✅ Al empleado y a la empresa les llega el correo con el motivo. ✅ En «Mi trabajo» del empleado, «Hoy» dice «Tu carnet no se ha aprobado · Motivo: …».
- [ ] **27.12 — Aprobar.** Con la fecha de caducidad puesta, aprueba. ✅ El empleado recibe «Tu carnet fitosanitario está aprobado» con «Válido hasta». ✅ La empresa recibe «El carnet fitosanitario de … está aprobado», y en su ficha ya puede marcar «Servicios fitosanitarios» y guardar.

**D. Renovar sin perder el carnet (el fallo grave de antes)**

- [ ] **27.13 — Autónomo con carnet aprobado.** Mi perfil → carnet → «¿Has renovado tu carnet? Súbelo» y envía uno nuevo. ✅ Sigue diciendo «Carnet aprobado · renovado en revisión». ✅ Una reserva de prueba de un tratamiento químico en su zona lo sigue enseñando en «Profesionales».
- [ ] **27.14 — Rechazar el renovado.** El admin rechaza ese renovado. ✅ El autónomo sigue con el carnet aprobado (y sigue saliendo en los químicos). ✅ Su correo dice «Tu carnet actual sigue valiendo hasta el …».
- [ ] **27.15 — Caducidad.** No hace falta esperar; lo cubren las pruebas SQL. Si quieres verlo, con permiso, pon en una cuenta de prueba la caducidad a 10 días:
  ```sql
  update gardener_licenses set expires_at = now() + interval '10 days' where id = '<id>';
  ```
  ✅ En el siguiente minuto llega «Tu carnet fitosanitario caduca el …» al titular y, si es empleado, a la empresa. Una sola vez.

> En local lo comprueban:
> - `supabase/tests/phyto_licenses_for_teams.test.sql`:
>   - nadie escribe la tabla desde la web;
>   - el almacén solo deja subir a quien toca;
>   - el archivo tiene que ser suyo y estar en su carpeta;
>   - límite de envíos, renovación, motivo, empresa, avisos y caducidad.
>
>   Se comprobó que falla con el comportamiento anterior.
> - Los tests de `PhytosanitaryLicenseUpload`, `TeamMemberCard`, `LicenseVerificationAdmin`, `phytoLicense` y `licenseEmailCopy`.
> - En el navegador, a 390 px, el recorrido completo:
>   - el empleado sube dos fotos;
>   - el admin rechaza;
>   - la empresa se lo pide y lo envía por él;
>   - el admin aprueba;
>   - la empresa le asigna fitosanitarios.
>
>   Los correos salieron con su destinatario y su asunto.

## Sección 28 — Continuar con Google y páginas legales (2026-10-21)

> **Qué es.** Rama `feat/acceso-google`.
> - Botón oficial de Google en la propia web:
>   - en `/auth`, para entrar y para crear cuenta de cliente;
>   - y en «Accede para continuar» de la reserva.
> - Si el navegador bloquea a Google, se usa la redirección clásica.
> - Dentro de Instagram, Facebook o TikTok se explica cómo abrir la web en el navegador.
> - Páginas `/privacidad` y `/terminos`.
> - En el admin, «Altas con Google · 30 días».
>
> **Despliegue:**
> 1. Configurar Google, Supabase y Vercel según `docs/auth/acceso-con-google.md`.
> 2. Completar los datos de `src/config/legal.ts`.
> 3. Migración `20261021120000`.
> 4. Fusionar.
>
> No toca funciones.
>
> **Antes de empezar:**
> - un móvil con una cuenta de Google que NO tenga cuenta en GarSer;
> - otra cuenta de Google cuyo Gmail SÍ tenga ya cuenta de cliente en GarSer;
> - Instagram instalado.

**A. Entrar y crear cuenta**

- [ ] **28.1 — Cuenta nueva.** En `/auth`, «Continuar con Google» y elige la cuenta nueva.
  - ✅ La ventanita de Google dice que vas a **garser.es**, no a «supabase.co».
  - ✅ Vuelves con la sesión iniciada y «¡Bienvenido a GarSer, …!».
  - ✅ En «Mi cuenta» están tu nombre y tu foto de Google.
  - ✅ Es una cuenta de cliente.
- [ ] **28.2 — Cuenta que ya existía.** Sal y entra con Google usando el Gmail que ya tenía cuenta. ✅ Es la misma cuenta: mismas reservas y «¡Hola de nuevo!». No se crea otra.
- [ ] **28.3 — Jardinero y empresa.** (Sustituida por la sección 32: ahora Google vale para los tres tipos de cuenta y primero se elige el tipo.)
- [ ] **28.4 — Cancelar.** Pulsa Google y cierra la ventanita sin elegir cuenta. ✅ Sigues en la misma pantalla, sin errores raros, y puedes volver a intentarlo.
- [ ] **28.5 — Cerrar sesión.** Sal. ✅ Al volver a `/auth`, Google puede sugerirte la cuenta («One Tap»), pero **no entra solo**.

**B. En la reserva (lo que más importa)**

- [ ] **28.6 — Sin perder la reserva.** Sin sesión, haz una reserva hasta «Accede para continuar».
  - ✅ «Continuar con Google» está arriba.
  - Elige la cuenta. ✅ Vuelves a la **misma pantalla**, con la reserva intacta y «… Ya puedes confirmar la reserva». Sin correos de confirmación.
  - Termina la reserva (pago de los gastos de gestión con tarjeta de prueba o real, según el entorno). ✅ Se crea a tu nombre.
- [ ] **28.7 — Desde Instagram.** Abre un enlace a garser.es desde Instagram (bio o mensaje) y llega a «Accede para continuar» o a `/auth`. Pulsa Google.
  - ✅ Sale «Google no deja iniciar sesión dentro de Instagram», con los pasos.
  - En Android, ✅ «Abrir en Chrome» abre la página en Chrome.
  - «Copiar enlace» y pégalo en Safari o Chrome: ✅ se abre la misma página y Google funciona.

**C. Páginas legales y admin**

- [ ] **28.8 — Legales.** En el pie de cualquier página pública, ✅ están «Privacidad» y «Términos y condiciones». ✅ Ya no queda ningún «[Completar: …]».
- [ ] **28.9 — Nota legal.** En `/auth` y en «Accede para continuar», ✅ sale «Al continuar, aceptas los Términos y condiciones y la Política de privacidad de GarSer», con los dos enlaces (abren otra pestaña).
- [ ] **28.10 — Admin.** Dashboard. ✅ «Altas con Google · 30 días» dice «X de N» y cuenta las cuentas de 28.1.

> En local lo comprueban:
> - los tests de `GoogleSignInButton`, `googleIdentity`, `oauthAccount`, `AuthForm`, las páginas legales, `PublicFooter` y `applicantRedirect`:
>   - el nonce (SHA-256 a Google, el original a Supabase);
>   - la redirección de respaldo y la vuelta solo a rutas internas;
>   - la detección de Instagram, Facebook y TikTok;
>   - que no se pisa el perfil ni se pone la foto de Google a un profesional.
> - En el navegador:
>   - el botón oficial de Google, de 358 px en el móvil;
>   - el aviso dentro de Instagram (simulado);
>   - la vuelta con error («Has cancelado…») y con sesión (lleva a la ruta pedida);
>   - el bloque de la reserva y las páginas legales en móvil y escritorio.
>
> El paso real por Google necesita las credenciales del paso 1 de la guía: se prueba aquí.

## Sección 29 — Comisiones configurables (2026-11-02)

> **Qué es.** Rama `feat/comisiones-configurables`.
> - El administrador decide en **Admin → Comisiones** cuánto cobra GarSer en cada tipo de reserva: primera reserva de un cliente de GarSer (12,5 %), primera por el enlace del jardinero (0 %), reservas posteriores (3 %), visitas de planes de mantenimiento (3 %) y posteriores de un cliente del enlace (0 %).
> - El servidor decide qué regla toca a cada reserva y hace la cuenta en céntimos. La web solo enseña lo que devuelve.
> - Cada reserva guarda regla, porcentaje, base, versión y fecha. Cambiar los porcentajes no toca reservas ni presupuestos ya firmados.
>
> **Despliegue (en este orden):**
> 1. `supabase db push` (cinco migraciones: `20261102130000`, `…140000`, `…150000`, `20261104130000` —clave del enlace— y `20261104140000` —textos públicos—).
> 2. `supabase functions deploy booking-authority booking-payment send-email-notification --use-api` (la tercera solo cambia dos frases de correo).
> 3. Fusionar (publica la web).
>
> Con las migraciones puestas y las funciones antiguas, todo sigue como hasta ahora, **salvo** que los enlaces `/reservar/<id>` sin clave dejan de eximir (la clave la verifica el servidor nuevo). Con las funciones nuevas y sin migración, las reservas se bloquean con un error recuperable (nunca se cobra de menos).
>
> **Importante (2026-11-04):** el origen «enlace» ya NO es una declaración del navegador: el enlace lleva una **clave secreta** (`/reservar/<id>?c=<clave>`) que SQL comprueba. Los enlaces y QR antiguos (sin clave) **no eximen**. Cada profesional ve su enlace en «Mi cuenta» y en «Marketing».
>
> **Antes de empezar:**
> - tu cuenta de administrador;
> - un jardinero de prueba con su enlace **completo con clave** (cópialo de su «Mi cuenta»);
> - dos cuentas de cliente nuevas (una para entrar desde garser.es y otra desde el enlace);
> - tarjeta de prueba de Stripe o real, según el entorno.

**A. El panel**

- [ ] **29.1 — Se ve y es el de partida.** Entra en **Admin → Comisiones**.
  - ✅ Cinco tarjetas con **12,5 / 0 / 3 / 3 / 0 %** y «Versión 1».
  - ✅ **No** sale el aviso ámbar «no usa estas comisiones» (si sale, falta desplegar las funciones del paso 2).
  - En **Ajustes** ✅ ya no está el interruptor «sin gastos de gestión»: hay una línea que lleva a «Comisiones».
- [ ] **29.2 — Valida.** En la primera tarjeta escribe, uno a uno, `-1`, `101`, `abc`, nada y `1,234`.
  - ✅ Cada uno muestra su mensaje en rojo y «Guardar configuración» queda desactivado.
  - ✅ Un campo vacío **no** se toma como 0.
- [ ] **29.3 — Guarda y persiste.** Pon la primera tarjeta en `13` y la de visitas de planes en `2,5`. Antes de guardar, ✅ sale «Cambios pendientes de guardar» con los dos cambios. Guarda.
  - ✅ «Configuración guardada (versión 2)» con los cinco valores que devuelve el servidor.
  - Recarga la página: ✅ siguen ahí.
  - Abre «Historial de cambios»: ✅ tu nombre, la hora y «12,5 % → 13 %».
- [ ] **29.4 — Dos pestañas.** Abre el panel en dos pestañas. Guarda un cambio en la A; sin recargar, cambia otro valor en la B y guarda.
  - ✅ La B avisa «La configuración ha cambiado mientras la editabas» y **no guarda**; «Cargar los valores actuales» trae lo de la A.
- [ ] **29.5 — Un cliente no entra.** Con una cuenta de cliente, abre `/admin/commissions`. ✅ Te saca del panel.
  - Con curl y el token de ese cliente: `curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/get_commission_settings" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN_CLIENTE" -H "Content-Type: application/json" -d '{}'` → ✅ error `42501` («Acceso denegado»). Lo mismo con `save_commission_settings`.
  - ✅ `GET /rest/v1/commission_settings` con ese token da error de permisos.
- Deja los valores otra vez en **12,5 / 0 / 3 / 3 / 0** antes de seguir.

**B. Reservas (con Stripe)**

- [ ] **29.6 — Cliente nuevo desde garser.es (12,5 %).** Entra sin pasar por ningún enlace de jardinero y reserva un servicio que cueste, por ejemplo, 158 €.
  - ✅ «Pagas hoy 19,75 € de gastos de gestión».
  - ✅ En Stripe, la autorización es de **19,75 €** exactos.
  - Termina la reserva. En el SQL editor: `select management_fee, management_fee_source, commission_rule, commission_rate_bps, commission_base_amount, commission_config_version, commission_fixed_at from bookings order by created_at desc limit 1;`
    ✅ `19.75 | payment_attempt | garser_first | 1250 | 158 | <versión> | <fecha>`.
  - `select origin from client_provider_relationships where client_id = '<id del cliente>';` ✅ `garser`.
- [ ] **29.7 — Cliente nuevo por el enlace del jardinero (0 %).** Con la otra cuenta, entra por el enlace **completo con clave** (`/reservar/<id>?c=<clave>`, el que se copia de «Mi cuenta») y reserva.
  - ✅ Al abrirlo, la dirección se queda en `/reservar/<id>` (la clave desaparece de la barra).
  - ✅ «Sin gastos de gestión», sin hoja de pago, y la reserva se crea al confirmar.
  - ✅ En SQL: `management_fee = 0`, fuente `waived_provider_link`, regla `link_first`, y su origen es `provider_link`.
- [ ] **29.8 — Cambiar el porcentaje con una reserva a medias.**
  - Con un cliente nuevo, llega a la pantalla de pago **sin pagar**.
  - En otra pestaña pon la primera regla en 15 %.
  - Vuelve y paga. ✅ Cobra el **12,5 %** con el que se firmó (no se rompe ni cobra el 15 %).
  - Empieza otra reserva con otro cliente nuevo. ✅ Ahora pide el 15 %.
  - ✅ Las reservas de 29.6 y 29.7 siguen con lo que tenían (`commission_config_version` antigua).
  - Vuelve la primera regla a 12,5.
- [ ] **29.9 — Reserva posterior (3 %).** Con el cliente de 29.6: el jardinero acepta y marca completada su reserva. Reserva otra vez con el mismo jardinero.
  - ✅ «Pagas hoy» es el **3 %** (por ejemplo 4,74 € sobre 158 €).
  - Cierra sesión y vuelve a entrar con ese cliente por el enlace `/reservar/<id>` de ese jardinero. ✅ **Sigue siendo el 3 %**: volver por otro enlace no le da el 0 %.
- [ ] **29.10 — Cliente del enlace que repite (0 %).** Con el cliente de 29.7 (su reserva ya completada): reserva otra vez, **sin** pasar por el enlace. ✅ Sin gastos de gestión (regla `link_repeat`).
- [ ] **29.11 — Visita de un plan (3 %).**
  - Con el cliente de 29.7 (el del enlace), crea un plan de mantenimiento desde su reserva completada.
  - Espera la propuesta (o fuérzala: `update maintenance_plans set next_visit_date = current_date + 3 where id = '<plan>'; select generate_maintenance_proposals();`).
  - ✅ La propuesta lleva el **3 %** de gastos, también para un cliente del enlace.
  - Confírmala. ✅ Stripe cobra ese importe y la reserva queda con regla `maintenance_visit`.
- [ ] **29.12 — Suelo de 0,50 €.** Pon la primera regla en `0,01` y reserva con un cliente nuevo. ✅ «Pagas hoy 0,50 €» y Stripe cobra 50 céntimos. Vuelve a 12,5.
- [ ] **29.13 — La frase de «Marketing» y del asistente de alta sigue a los ajustes.** En «Marketing» de un jardinero, ✅ sale «Tus clientes reservan contigo sin gastos de gestión (salvo en las visitas de un plan de mantenimiento)» con los valores de partida. Pon la regla de primera por enlace en `1`: ✅ pasa a «Tus clientes reservan directamente contigo.». Devuélvela a 0.
- [ ] **29.14 — Lo que se imprime NO habla de gastos de gestión.** Descarga un flyer, una tarjeta y el QR, y copia un mensaje de WhatsApp y el pie de foto. ✅ Ninguno menciona «gastos de gestión», «comisión» ni «gratis».

**B. La clave del enlace (2026-11-04)**

- [ ] **29.15 — El enlace sin clave no exime.** Con un cliente nuevo, entra por `/reservar/<id>` **sin** `?c=` y reserva. ✅ Paga la comisión de GarSer (12,5 %) y, en la hoja de pago, **no** aparece «sin gastos de gestión». Mismo resultado con una clave inventada (`?c=00000000000000000000000000000000`).
- [ ] **29.16 — El aviso.** Con un cliente nuevo, entra con una clave inventada hasta «Profesionales». ✅ Aparece «Este enlace ya no es el directo de <nombre>…» y paga los gastos. Con el enlace sin clave **no** aparece el aviso.
- [ ] **29.17 — Cambiar el enlace.** En «Mi cuenta» del jardinero, pulsa **Cambiar mi enlace** y confirma. ✅ Sale el enlace nuevo. Con un cliente nuevo: el enlace **antiguo** paga el 12,5 % y el **nuevo** va a 0 €. ✅ Los QR y flyers descargados antes siguen abriendo su perfil pero ya no eximen (hay que volver a descargarlos).
- [ ] **29.18 — Nadie ve las claves.** Con una cuenta de cliente, en la consola del navegador: `await supabase.rpc('my_booking_link')` (o desde el SQL editor, como `authenticated`) ✅ error «Solo un profesional tiene enlace de reserva». `select * from provider_booking_links` ✅ sin permiso.
- [ ] **29.19 — La clave no viaja a terceros.** Abre el enlace completo con el **Pixel de Meta** activo (Meta Pixel Helper o la pestaña de red). ✅ Ninguna petición a `facebook.com` ni `google` lleva `c=<clave>`.

**C. Textos que cambian con los ajustes (2026-11-04)**

- [ ] **29.20 — /para-jardineros sigue a los ajustes.** Con los valores de partida, abre `/para-jardineros`. ✅ «Tus clientes reservan sin gastos de gestión (salvo en planes de mantenimiento)»; «Y si un cliente que te trajo GarSer vuelve a reservar contigo, paga menos gastos de gestión.» (**no** «deja de pagar»). Pon la regla de reservas posteriores en `0`: ✅ pasa a «deja de pagar». Pon las dos reglas del enlace en `12,5`: ✅ desaparece cualquier «sin gastos de gestión». Devuelve todo a los valores de partida.
- [ ] **29.21 — Vista previa del panel.** En **Admin → Comisiones** cambia un porcentaje **sin guardar**: ✅ «Lo que dirá la web» cambia con lo que escribes y avisa «todavía sin guardar».
- [ ] **29.22 — Sin saber los ajustes, no promete nada.** En las herramientas del navegador, bloquea la petición a `get_public_billing_terms` y recarga `/para-jardineros`. ✅ Dice «Tus clientes reservan directamente contigo» y «Los gastos de gestión, si los hay, los paga el cliente, aparte»; ✅ **ningún** «sin gastos de gestión».
- [ ] **29.23 — El SEO no promete.** Ver el código fuente de `/para-jardineros` y de `/`: ✅ ni `title` ni `description` ni JSON-LD de las preguntas dicen «sin comisión»; las respuestas de las preguntas coinciden con lo que se ve en pantalla.

**D. Dinero con Stripe real (con tarjeta de prueba si el entorno lo permite)**

- [ ] **29.24 — Cancelar con 24 h o más / menos.** ✅ Con 24 h o más de una reserva ya cobrada, se **devuelve** (Stripe muestra el reembolso). ✅ Con menos de 24 h de una reserva **aceptada**, no se devuelve. ✅ Con menos de 24 h de una solicitud **sin aceptar**, **se cobra** (lo dicen los términos y el aviso de cancelar). El aviso del cuadro de cancelar dice «24 h o más» / «menos de 24 h».
- [ ] **29.25 — Tras cancelar, el texto no miente.** En la tarjeta de una reserva cancelada ✅ **no** dice «No se te ha cobrado nada»: explica la regla (se devuelve con 24 h o más o si cancela el profesional; con menos, no).
- [ ] **29.26 — Rechazo y caducidad.** ✅ Si el jardinero **rechaza**, Stripe muestra la autorización cancelada y el cliente no paga. ✅ Si **caduca** (24 h sin respuesta), la autorización se libera en cuanto pasa el reloj (hasta ~20 min después).

> **Qué se ha comprobado ya en local (2026-11-04), con Stripe en modo prueba:**
> - SQL: PGlite **y el Postgres real de Supabase** (`supabase/tests/commission_settings.test.sql`).
> - `scripts/commissions/verify-commissions.mjs` (37/37): reglas, clave del enlace, planes, 0,50 €, manipulaciones, sin configuración.
> - `scripts/commissions/verify-commissions-stripe.mjs` (**40/40, con Stripe real de pruebas**): autorizar, capturar al aceptar, liberar al rechazar/caducar, cancelar con 24 h o más / menos / en el límite, cancela el profesional, tarjeta rechazada y reintento, webhooks (firma falsa, repetido, caducado, importe o divisa manipulados), cambio de precio, planes, 0,50 €, 100 %, 21 porcentajes con decimales, cambio de ajustes con un pago en curso, sin configuración.
> - vitest, el navegador real contra la base local (clave capturada y quitada de la dirección; textos que cambian al cambiar los ajustes).
> - Lo que **no** se ha podido comprobar en local y cubre esta sección contra producción: 3-D Secure, el formulario real de Stripe Elements, las funciones desplegadas de verdad y el Pixel de Meta.

## Sección 30 — Avisos al administrador (2026-11-04)

Cada novedad que espera la revisión del administrador avisa **por correo** y **por notificación al móvil** a todas las cuentas de administrador, y aparece como número rojo en el menú del panel.

Requisitos previos (acciones tuyas, ver el informe de la tarea): migración `20261104150000` aplicada, `send-email-notification` redesplegada con `--use-api`, y en tu cuenta de administrador **Mi cuenta → Notificaciones activadas** en el móvil.

- [ ] **30.1 — Solicitud de jardinero.** Con una cuenta de prueba, envía una solicitud de alta de jardinero. ✅ En 1-2 minutos llega a **todos** los correos de administrador «Nueva solicitud de jardinero para revisar» con nombre, zona, servicios y experiencia, y un botón que abre **Admin → Usuarios**. ✅ Llega también la notificación al móvil (si la activaste). ✅ «Usuarios» muestra un número rojo.
- [ ] **30.2 — Una sola vez.** Edita la solicitud ya enviada (sin cambiar de estado) y recarga el panel. ✅ **No** llega un segundo correo.
- [ ] **30.3 — Reenvío tras corregir.** Rechaza la solicitud con un motivo; con la cuenta de prueba, corrígela y reenvíala. ✅ Llega un **nuevo** aviso (es otra revisión).
- [ ] **30.4 — Solicitud de empresa.** Envía una solicitud de alta de empresa. ✅ Llega «Nueva solicitud de empresa para revisar» con nombre comercial, contacto y servicios; el botón abre **Admin → Usuarios**.
- [ ] **30.5 — Carnet fitosanitario.** Sube un carnet (propio y, aparte, uno de un empleado desde una empresa). ✅ Llega «Nuevo carnet fitosanitario para revisar» (titular, quién lo envía, caducidad); el botón abre **Certificados Fito.**; el menú muestra el número.
- [ ] **30.6 — Incidencia.** Abre una incidencia desde una reserva. ✅ Llega «Nueva incidencia para revisar» con quién la abre, el motivo y un extracto del texto; el botón abre **Incidencias**. ✅ El aviso que ya recibía la otra parte sigue llegando igual.
- [ ] **30.7 — Lo ya resuelto no avisa.** Aprueba la solicitud o el carnet **antes** de que llegue el correo (o desactiva el reloj un minuto). ✅ El correo no llega (el estado se comprueba al enviar). ✅ En el resumen «Pendiente ahora» de cada correo, los números coinciden con los del menú.
- [ ] **30.8 — Los números del menú bajan.** Aprueba o rechaza una solicitud y navega a otra sección del panel. ✅ El número rojo baja sin recargar a mano.
- [ ] **30.9 — Nada se rompe si el aviso falla.** (Solo lectura) En el registro de la función, ✅ ningún error `admin_review_needed no se pudo apuntar` durante las pruebas anteriores.
- [ ] **30.10 — Privacidad.** ✅ El correo **no** incluye teléfono, dirección completa ni el documento del carnet; solo lo necesario para decidir si hay que entrar a revisar. ✅ Un cliente o un profesional (no administrador) que llame a `admin_pending_review_counts` recibe error de permisos.

> **Comprobado ya en local (2026-11-04):** SQL en Postgres real (`supabase/tests/admin_review_notifications.test.sql`: avisos por cada tabla, sin duplicados, reenvío, un fallo al apuntar no tumba la acción, contadores solo para administradores); 24 tests del texto y la lectura de datos; cadena completa trigger → cola → campana → `notification-dispatch` → `send-email-notification` (3 administradores × 2 avisos, correo simulado); contadores del menú con y sin la función en la base. **No** comprobado en local: el envío real por Brevo (SMTP) y la notificación al móvil (necesitan los secretos de producción).

---

## Sección 31 — Logo vectorial sin fondo (2026-11-04)

El logo de GarSer.es de la web ya no es un PNG con recuadro blanco: es el SVG vectorial (`/garser-logo.svg`), transparente y nítido a cualquier tamaño. Lo pinta un único componente (`GarserLogo`), así que sale igual en el encabezado, `/auth`, las páginas legales y la invitación de empleado.

Requisitos previos: solo el despliegue del front en Vercel (sin migraciones ni funciones). Si tu navegador conserva la web antigua, recarga a fondo (Cmd+Shift+R) antes de juzgar.

- [ ] **31.1 — Encabezado.** Abre garser.es sin sesión y, después, con sesión iniciada. ✅ Arriba a la izquierda se ve el logo nítido: «GarSer» oscuro, «.es» verde y la curva verde debajo, **sin recuadro blanco** alrededor. ❌ Borroso, pixelado o con un rectángulo blanco: sigue saliendo el PNG antiguo (recarga a fondo, o el despliegue no es el último).
- [ ] **31.2 — Acceso.** Abre `/auth` (iniciar sesión y «Crea tu cuenta»). ✅ Logo grande, nítido, sin sombra ni recuadro.
- [ ] **31.3 — Páginas legales.** Abre `/privacidad` y `/terminos`. ✅ El mismo logo arriba a la izquierda.
- [ ] **31.4 — Móvil.** Con el móvil (o el navegador a 375 px de ancho) abre `/` y `/auth`. ✅ Logo completo, sin cortarse ni desplazar la página en horizontal; en `/` queda hueco entre el logo y los botones «Contacto y ayuda» y «Acceder».
- [ ] **31.5 — Nitidez.** Aumenta el zoom al 300 % (Cmd/Ctrl y «+») o mira desde una pantalla retina. ✅ Los bordes siguen limpios: es vector.
- [ ] **31.6 — Archivo directo.** Abre `https://garser.es/garser-logo.svg`. ✅ Se ve el logo (no un 404).

> **Comprobado ya en local (2026-11-04):** `GarserLogo.test.tsx` (4 tests: apunta al SVG y el archivo existe, el SVG solo tiene trazados y ningún fondo, reserva el hueco de la imagen, texto de respaldo si falla); en el navegador, `/`, `/auth`, `/privacidad` y `/invitacion` cargan `garser-logo.svg` sin errores de consola; sobre un fondo verde el logo nuevo es transparente y el PNG antiguo enseñaba su recuadro blanco; a 375 px no hay desplazamiento horizontal. **No** comprobado: el `Navbar` con sesión iniciada (mismo componente, mismas clases y fondo blanco que el encabezado público).

## Sección 32 — Acceso en el móvil y tipo de cuenta con Google (2026-11-04)

Tres fallos de `/auth` desde el móvil: la página era larga y recargada; un jardinero podía crearse una cuenta de **cliente** sin darse cuenta (el tipo venía marcado y Google estaba a un toque); y al elegir «jardinero» o «empresa» con Google la persona acababa viendo el panel de cliente. Ahora «Crear cuenta» empieza por una pregunta («¿Cómo vas a usar GarSer?»), nada viene marcado, y el tipo elegido se aplica y se comprueba antes de entrar.

Requisitos previos:
- migración `20261104160000_account_type_declaration_status.sql` aplicada (comprobación abajo) y front desplegado en Vercel; sin funciones.
- Para Google, 3 Gmail: uno **nuevo** (sin cuenta en GarSer), otro **nuevo** distinto, y uno que ya sea **cliente con alguna reserva**.
- Si tu navegador conserva la web antigua, recarga a fondo antes de juzgar.

**A. Diseño en el móvil**

- [ ] **32.1 — Entrar cabe en una pantalla.** Abre `/auth` en el móvil. ✅ Arriba «Entrar | Crear cuenta»; debajo, Google, «o con tu correo», correo, contraseña y el botón **Entrar**, todo visible sin bajar (en un iPhone normal). ✅ Abajo, un recuadro «¿Eres jardinero o empresa? Crea tu cuenta profesional». ❌ Bloques enormes o botones cortados.
- [ ] **32.2 — Crear cuenta empieza por la pregunta.** Toca «Crear cuenta». ✅ Solo se ve «¿Cómo vas a usar GarSer?» con tres filas (Cliente, Jardinero, Empresa), **ninguna marcada**, y «Después no podrás cambiar el tipo de cuenta». ✅ **No** hay Google ni formulario todavía.
- [ ] **32.3 — Elegir Jardinero.** Toca «Jardinero». ✅ El título pasa a «Crea tu cuenta de jardinero», sale el aviso verde («…La revisamos antes de publicarte») y ahora sí «Registrarse con Google» y el formulario. «Cambiar tipo de cuenta» vuelve a la pregunta. Con **Empresa** el aviso habla de los datos de la empresa; con **Cliente** no hay aviso.
- [ ] **32.4 — Teclado y contraseña.** Toca «Correo electrónico». ✅ La pantalla **no hace zoom** y el teclado trae la «@». En «Contraseña», ✅ el ojo muestra y oculta lo escrito. En «Crear cuenta», si «Repite la contraseña» no coincide, ✅ lo dice debajo del campo.
- [ ] **32.5 — Recuperar contraseña.** «¿Has olvidado tu contraseña?». ✅ Pantalla propia con «Enviar enlace»; pide confirmar antes de enviar; «Volver a entrar» regresa.
- [ ] **32.6 — Desde la web de jardineros.** En `/para-jardineros`, pulsa el botón de registrarte como jardinero y, en otra prueba, como empresa. ✅ Llegas a `/auth` ya con el tipo elegido (sin la pregunta).
- [ ] **32.7 — Volver.** «‹ Volver a la web» (arriba a la izquierda) lleva al inicio.

**B. Tipo de cuenta con Google (lo que más importa)**

- [ ] **32.8 — Jardinero con Google.** Con el Gmail nuevo n.º 1: «Crear cuenta» → «Jardinero» → «Registrarse con Google».
  - ✅ Entras **directamente en la solicitud de jardinero** («Tus datos», `/apply`). ❌ El panel de cliente («Hola de nuevo… Empezar una reserva»), aunque sea un instante.
  - ✅ En el panel del admin, «Profesionales» (o «Usuarios»), esa cuenta figura como **jardinero**.
- [ ] **32.9 — Empresa con Google.** Con el Gmail nuevo n.º 2: «Crear cuenta» → «Empresa» → Google. ✅ Entras en el alta de empresa (`/empresa/solicitud`). ✅ En el admin figura como **empresa**.
- [ ] **32.10 — «Entrar» con Google sin tener cuenta.** Con otro Gmail nuevo: `/auth` (pestaña «Entrar») → «Continuar con Google». ✅ **Antes de seguir** sale «Te damos la bienvenida… Hemos creado tu cuenta. ¿Cómo vas a usar GarSer?». «Cliente» → panel de cliente; en otra prueba «Jardinero» → `/apply`. ❌ Entrar en el panel de cliente sin preguntar.
- [ ] **32.11 — Cuenta que ya existe.** Con un Gmail que ya tiene cuenta: «Entrar» → Google. ✅ Entra directo («¡Hola de nuevo!»), **sin** preguntar nada.
- [ ] **32.12 — Cliente con reservas que prueba Jardinero.** Con el Gmail que ya es cliente con reservas: «Crear cuenta» → «Jardinero» → Google.
  - ✅ Sale «Este correo ya tiene una cuenta de cliente» con el motivo, **sin** entrar y sin cambiar nada.
  - «Usar otro correo» ✅ cierra la sesión y vuelve a `/auth` **sin** el cartel de «sesión cerrada desde otro dispositivo». «Seguir como cliente» ✅ entra en su panel.
- [ ] **32.13 — Cliente normal.** Gmail nuevo: «Crear cuenta» → «Cliente» → Google. ✅ «¡Bienvenido a GarSer!» y panel de cliente, sin preguntas de más.
- [ ] **32.14 — Si falla, no engaña.** (Opcional, con el modo avión justo después de elegir cuenta de Google.) ✅ Si no se pudo dejar la cuenta como jardinero, sale «No hemos podido crear tu cuenta de jardinero» con **Reintentar**; nunca entra «como cliente» en silencio.
- [ ] **32.15 — Desde Instagram o con el script de Google bloqueado.** (Vuelta por redirección.) Abre el enlace en el navegador y repite 32.8. ✅ Mismo resultado: la vuelta pasa por `/auth/callback` y la cuenta queda de jardinero.
- [ ] **32.16 — La reserva con Google sigue igual.** Repite 28.6. ✅ Sin cambios: «Continuar con Google» arriba, vuelves a la misma pantalla, sin pregunta de tipo.

**C. Comprobación en la base de datos** (Supabase → SQL Editor)

```sql
-- Debe devolver: text
select pg_get_function_result('public.self_declare_signup_role(text)'::regprocedure);
-- Las cuentas de las pruebas 32.8 y 32.9 (poner tus Gmail):
select u.email, p.role
from auth.users u join public.profiles p on p.user_id = u.id
where u.email in ('gmail-nuevo-1@gmail.com', 'gmail-nuevo-2@gmail.com');
-- Esperado: 32.8 → gardener, 32.9 → company
```

> **Comprobado ya en local (2026-11-04), con el código real y la base local** (solo se sustituyó la ventana de Google por un inicio de sesión de una cuenta «tipo Google» recién creada): `AuthForm.test.tsx` (30+ tests), `oauthAccount.test.ts`, `GoogleSignInButton.test.tsx`; en el navegador a 320, 375 y escritorio: Jardinero con Google → `/apply` y rol `gardener`; Empresa → `/empresa/solicitud` y `company`; «Entrar» con Google en cuenta nueva → pregunta → Empresa/Jardinero; cliente con actividad → aviso y rol sin cambiar; fallo simulado → «Reintentar» → `company`; vuelta por redirección con el tipo solo guardado en el navegador → `company`.

---

## Sección 33 — Alta y primeros pasos del profesional en el móvil (2026-11-05)

> **Nota (2026-11-08):** desde la sección 34 ya **no existe la cuenta «Empresa»** ni su alta por solicitud. Donde esta sección habla de «cuenta de empresa» (33.1, la parte de empresa de 33.2 y 33.7, 33.4 y 33.17), léase «profesional con equipo» (modo equipo) y no se prueba el alta de empresa: se sustituye por 34.1 a 34.6.

Nueve fallos que salieron al crear una cuenta de jardinero y de empresa desde el iPhone: encabezados que se pisan, progreso y mensaje «en revisión» tapados, zona de trabajo sin confirmar, horario preconfigurado, estado de la solicitud que no se actualizaba, servicios sin activar y una ayuda que obligaba a adivinar. Detalle y causas: `docs/audit/2026-11-05-ux-movil-onboarding-profesional/SEGUIMIENTO.md`.

Requisitos previos: solo el despliegue del front en Vercel (**sin migraciones ni funciones**). **Todas con el iPhone y la web instalada en la pantalla de inicio**, y recarga a fondo (o cierra y abre la app) para no ver la versión antigua. Necesitas: una cuenta de jardinero **recién aprobada** (sin servicios), otra de **empresa** y, de ser posible, el panel de admin en otro dispositivo.

**A. Encabezados (lo que no se reproduce en un ordenador)**

- [ ] **33.1 — Alta de empresa.** Entra con una cuenta de empresa sin enviar (o crea una) y abre `/empresa/solicitud`. ✅ Debajo de la barra de GarSer.es hay **siempre** una franja con «Alta de empresa · Paso X de 5» y la barra de progreso, **aunque hayas bajado o subido la pantalla**. Pasa de paso con «Siguiente» y vuelve atrás con «Atrás». ❌ La barra tapada por la cabecera y solo visible deslizando hacia abajo.
- [ ] **33.2 — «Solicitud en revisión».** Con la solicitud enviada, mira la pantalla de espera (empresa: `/empresa/estado`; jardinero: `/status`). ✅ La tarjeta se ve **entera**, debajo de la barra de GarSer.es, y la pantalla **no tiene scroll de más** (no hay nada que bajar). ❌ La barra tapa parte de la tarjeta.
- [ ] **33.3 — Alta de jardinero.** `/apply`. ✅ La franja «Alta de jardinero · Paso X de 5» queda fija bajo la barra al hacer scroll.
- [ ] **33.4 — Panel de empresa.** Entra con la empresa aprobada. Baja y sube en cada pestaña (Agenda, Equipo, Marketing, Tu empresa). ✅ La barra de GarSer.es queda **siempre arriba** y el nombre de la empresa con sus pestañas se pega **justo debajo**; nunca se montan una encima de la otra.
- [ ] **33.5 — Resto de pantallas con cabecera.** Mis reservas, Chat, Mi cuenta y «Gestión de disponibilidad» (jardinero y empresa), y «Mi trabajo» de un empleado. ✅ Mismo comportamiento: dos barras apiladas, sin solaparse, también con el menú ☰ abierto.

**B. Estado de la solicitud (fallo 6)**

- [ ] **33.6 — Actualizar estado.** Con una solicitud en revisión, pulsa «**Actualizar estado**». ✅ Sale «Sigue en revisión. Te avisaremos por correo…» y la pantalla no parpadea.
- [ ] **33.7 — Aceptar sin cerrar sesión.** Con la pantalla de espera abierta en el móvil, **acepta la solicitud desde el panel de admin**. En el móvil pulsa «Actualizar estado». ✅ Entras al panel (de jardinero o de empresa) **sin cerrar sesión**. Repite saliendo de la app, esperando 15 s y volviendo a abrirla **sin pulsar nada**: ✅ entra sola.

**C. Zona de trabajo (fallo 4)**

- [ ] **33.8 — Confirmar esta dirección.** Con una cuenta recién aprobada (dirección escrita, sin tocar nada): «Mi perfil → Cobertura». ✅ Sale «Falta confirmar tu zona de trabajo» con tu dirección, los km y el botón **«Confirmar esta dirección»**. Púlsalo. ✅ «Zona confirmada»; el botón desaparece; en el panel, el paso «Zona de trabajo» queda hecho. Con una dirección inventada: ✅ aviso rojo y el botón sigue ahí.

**D. Horario sin preconfigurar (fallo 5b)**

- [ ] **33.9 — Todo vacío.** Cuenta nueva → «Horario» → «Horario fijo». ✅ «Desde/Hasta», «Semanas de agenda» y «Antelación mínima» dicen **«Elige…»** (nada de 9-17, «1 mes» ni «24 horas»). Marca un día: ✅ **no se rellena** el calendario hasta elegir las dos horas. Al tocar un selector, ✅ el móvil **no hace zoom**.
- [ ] **33.10 — Aviso y guardado.** ✅ Arriba, «Te quedan cosas por configurar en tu horario» con la lista, que se vacía según eliges. Pulsa «Guardar cambios» **sin** elegir semanas ni antelación: ✅ avisa, marca los campos en rojo y **no guarda**. Elígelos y guarda: ✅ se guarda y el aviso desaparece. En la ayuda, el paso recomendado «Reglas de tu horario» queda hecho.

**E. Activar servicios (fallo 7.1)**

- [ ] **33.11 — Botón «Activar».** «Mi perfil → Servicios». ✅ Cada servicio tiene un botón **«Activar»**: gris **muy claro** si aún no tiene precio, gris **más oscuro** si está configurado, **verde «Activado»** si está activo. Toca uno claro: ✅ avisa «Primero configura el precio de…» y abre su configuración. Toca uno oscuro: ✅ pasa a verde y sale «Servicio … activado». Toca uno verde: ✅ se desactiva.
- [ ] **33.12 — En la ayuda.** Configura el precio de dos servicios **sin activarlos**. ✅ La ayuda dice «**Tienes 2 servicios configurados pero sin activar**» con un botón «Activar» por servicio; pulsa uno: ✅ pasa a verde y el paso se actualiza.
- [ ] **33.13 — «¿Lo activas ahora?».** Guarda un precio válido de un servicio apagado. ✅ Sale «Precio guardado. ¿Activas … ahora?» con botón **«Activar»**.

**F. Primeros pasos guiados (fallo 7.2)**

- [ ] **33.14 — La guía, primero.** Cuenta recién aprobada, abre el panel. ✅ «Completa tu cuenta profesional» está **arriba**, antes de los seis botones; el paso «ahora» sale abierto («Paso 1 de 3 · ahora») con **«Qué tienes que hacer»** en pasos; los demás, en una línea con «Ver cómo».
- [ ] **33.15 — Recorrido completo.** Sigue la guía hasta el final: Servicios → Zona → Horario. En cada pantalla, ✅ arriba sale «Primeros pasos · Paso X de N» con lo que hay que hacer; al terminar el paso, **«¡Hecho!» + «Siguiente paso: …»**; al terminar el último, «¡Todo listo!». Al volver al panel: «Ya apareces a los clientes» y la ayuda pasa **debajo** de los botones.
- [ ] **33.16 — No te pierdes.** Deja a medias la configuración dentro de «Disponibilidad», cierra la app y vuelve a abrirla. ✅ Entras en el **panel** (con la guía), no dentro de «Disponibilidad».
- [ ] **33.17 — Empresa.** El panel de la empresa muestra la misma guía numerada («Paso X de 6 · ahora»).

> **Comprobado ya en local (2026-11-05):** 185 archivos y 2.824 tests; y navegando a 375 px (y 320 px para desbordes) con cuentas locales de jardinero nuevo, jardinero completo, empresa en alta, empresa en revisión, empresa aprobada y empleado: pila de barras medida en las 6 pantallas, progreso fijo en las dos altas, `/empresa/estado` sin scroll, aceptación por el admin con la pantalla abierta, confirmar dirección con geocodificación real (y con dirección imposible), horario vacío con validación, activación desde la ayuda y desde Mi perfil, el aviso «¿Activas…?» tras guardar por el configurador real y el recorrido guiado completo hasta «Ya apareces». **Lo único que no se puede comprobar fuera del iPhone son 33.1 y 33.2.**

---

---

## Sección 34 — Cuenta de profesional única y dinámica (2026-11-08)

Una sola cuenta «Profesional» que se adapta: **individual** (el jardinero de siempre) y, al aceptar su primer compañero, **equipo** (la app de empresa). Vuelve a individual cuando se va el último, sin perder nada. Diseño, decisiones y pruebas en `docs/garser-empresas/08-CUENTA-PROFESIONAL-DINAMICA.md` (D31–D40).

Requisitos previos: **migración `20261108120000_cuenta_profesional_dinamica.sql`** aplicada, **`send-email-notification` redesplegada** (`--use-api`) y el front en Vercel. **Con el iPhone y la web instalada** para 34.8; el resto vale con el móvil o con el navegador a 375 px. Necesitas: un profesional **aprobado y con precios, zona y horas** (el tuyo), con una **reserva futura y una reseña**, y una **cuenta de cliente nueva** (otro correo) para ser tu compañero.

**A. Registro**

- [ ] **34.1 — Un solo tipo.** `garser.es/auth` → «Crear cuenta». ✅ Solo **Cliente** y **Profesional** («Ofrezco mis servicios de jardinería, solo o con mi equipo»); **no hay «Empresa»**. Abre `garser.es/auth?mode=signup&role=company` (un enlace antiguo): ✅ entra como **Profesional**.

**B. Modo individual**

- [ ] **34.2 — Sin rastro de empresa.** Entra con tu profesional (sin equipo). Recorre Panel, Solicitudes, Horario, Mi perfil (las 3 pestañas), Reseñas, Marketing, Reservas, Chat, Mi cuenta (y «Cerrar cuenta») y el menú ☰. ✅ **Ni una palabra de «empresa», «empleado» ni «equipo»** salvo la tarjeta del panel «¿Trabajas con más gente? **Añadir a mi equipo**». La etiqueta de Mi cuenta dice «Jardinero».
- [ ] **34.3 — Invitar al primer compañero.** Pulsa «Añadir a mi equipo». ✅ Sale una hoja con **Qué cambia / Qué sigue igual**, la frase del **seguro de responsabilidad civil** (casilla) y el correo. ✅ **No deja enviar** sin marcar la casilla. Marca, escribe el correo de tu cliente nuevo y envía: ✅ «Le hemos enviado la invitación…», un enlace para copiar y «**Mientras no acepte, tu cuenta no cambia**». Cierra la hoja: ✅ el panel sigue siendo el de siempre, con «**Invitaciones pendientes (1)**», su fecha de caducidad y «Anular». Anula y vuelve a invitar: ✅ **no pide otra vez el seguro**.

**C. Pasar a equipo (bloqueante)**

- [ ] **34.4 — Aceptar y ver el cambio.** Antes, **anota** tu enlace de reserva (Mi cuenta), tu nº de reseñas, el precio de un servicio y tu reserva futura. El compañero abre su enlace (móvil o navegador) y **acepta**. En tu móvil, pulsa «**¿Ya ha aceptado? Actualizar**» (o sal de la app 20 s y vuelve). ✅ Sin recargar ni cerrar sesión, salta al **panel de equipo** (`/empresa`, con el nombre de tu ficha y las pestañas Agenda · Equipo · Marketing · Tu empresa) y sale «**Ya tienes equipo**» (una sola vez). **Comprueba que sigue todo igual**: enlace de reserva y QR, reseñas (también en «Tu empresa → Reseñas»), precios, la reserva futura (mismo día, hora y estado) y tu perfil público. ❌ Cualquier cambio en esto es **bloqueante**.
- [ ] **34.5 — Las horas suman.** Asigna un servicio a tu compañero y dale horas libres. Abre tu enlace de reserva como cliente: ✅ las horas válidas son las **tuyas más las de tu compañero**. Reserva una hora que solo tiene él: ✅ la hace él; una que solo tienes tú: ✅ la haces tú.

**D. Volver a individual (bloqueante)**

- [ ] **34.6 — La baja del último.** Con el equipo configurado (reparto manual, capacidad 2…), da de baja a tu compañero (sin trabajos suyos por delante: si los tiene, ✅ **te lo impide** y te dice que los reasignes). ✅ Vuelves solo al **panel de siempre** y sale «**Vuelves al modo individual**». ✅ No queda ninguna reserva «por asignar»; el reparto vuelve a automático y la capacidad a 1; el titular vuelve a trabajar. ✅ Enlace, reseñas, precios y reservas **exactamente como antes** (compara con lo anotado en 34.4).
- [ ] **34.7 — Volver a crecer.** Invita otra vez: ✅ no pide el seguro, se reutiliza la misma empresa y tus servicios activos entran solos en la agenda del equipo.

**E. Reglas y correos**

- [ ] **34.8 — iPhone (PWA).** Con la web instalada: acepta la invitación desde otro dispositivo mientras tienes la app abierta, bloquea el móvil, desbloquéalo. ✅ Al volver, el modo se actualiza solo (≤ 20 s) y sale el aviso.
- [ ] **34.9 — Un profesional no es empleado de otro.** Con otro profesional (con ficha), abre el enlace de una invitación. ✅ Dice que su cuenta es de profesional y que necesita una distinta; **no se une**.
- [ ] **34.10 — Correos.** El admin aprueba un carnet fitosanitario a tu profesional **en modo equipo**: ✅ el correo lleva a «Tu empresa» (`/empresa?tab=company`). Tras volver a individual, otro: ✅ **no** lleva a `/empresa`.
- [ ] **34.11 — Cuentas de prueba antiguas.** Las cuentas que eran «Empresa» entran ahora como **profesional** (modo equipo si tenían empleados, individual si no). Las que tenían un alta de empresa a medias no tienen solicitud: ✅ van a «Alta de jardinero» (se recrean a mano).

> **Comprobado ya en local (2026-11-08):** 197 archivos y 2918 tests; `supabase db reset` desde cero; 8 ficheros de SQL; **29 baterías de Empresas** (incluida la nueva `verify-professional-mode`, 22 comprobaciones: registro, promoción, aceptación, horas que suman, ida y vuelta sin pérdidas, reparto manual → individual sin reservas colgando, reutilización de la empresa latente y carnet del titular, correos por modo) y las 7 de servicios; y navegador a 375×812 con un profesional demo (individual → invitación → equipo → baja → individual), con las capturas de `docs/garser-empresas/capturas-08/`.

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
| [ ] | Sección 21 verde — formularios manuales con el mismo precio que antes (21.2 es bloqueante) |
| [ ] | Sección 29 verde — comisiones configurables (29.6, 29.7 y 29.8 son bloqueantes: es dinero) |
| [ ] | Sección 32 verde — acceso en el móvil y tipo de cuenta con Google (32.8, 32.9 y 32.10 son bloqueantes: un profesional no puede acabar como cliente) |
| [ ] | Sección 33 verde — alta y primeros pasos en el móvil (33.1 y 33.2, con el iPhone, son bloqueantes: un profesional no puede quedarse sin ver su progreso ni su estado) |
| [ ] | Sección 34 verde — cuenta de profesional única y dinámica (34.4 y 34.6 son bloqueantes: al pasar a equipo y al volver no se puede perder ni cambiar nada: reservas, reseñas, enlace, precios) |
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
