# GarSer — Guion de implementación para cierre de producción

Runbook paso a paso para cerrar los hallazgos de `REPORT.md` y dejar la web **limpia, rápida, sin código muerto y sin funciones infuncionales o inseguras**. Basado en la auditoría del 2026-07-12.

---

## Cómo funciona este documento (protocolo de trabajo)

1. Tú me dices: **"empieza con el paso N"**.
2. Yo implemento **solo ese paso** en una rama, corro `vitest` + `lint` + `build`, y te aviso: **"paso N terminado"**, contándote (a) qué ha hecho la implementación y (b) exactamente qué probar en local.
3. Si un paso necesita algo tuyo **antes** de poder probar (plantillas de email, claves, secrets…), te lo digo con instrucciones exactas.
4. Tú pruebas en local siguiendo la checklist del paso.
5. Si todo sale bien, me dices **"avanza al paso N+1"**. Si algo falla, me lo dices y lo corrijo antes de avanzar.
6. **⏸ Yo me detengo SIEMPRE al final de cada paso. Nunca encadeno dos pasos sin tu confirmación.**

### Regla de oro de seguridad
**Nada se sube a producción hasta el final.** Todo el desarrollo y todas las pruebas son **en local**. La subida a producción (git push + aplicar migraciones + redesplegar funciones + tus tareas de dashboard) es la **Fase Final**, y la haremos junta, con tu aprobación explícita por cada acción que toque producción real. Durante todo el proceso, para pagos usamos **Stripe en modo test** (tarjetas de prueba, sin dinero real); el dinero real solo aparece en la prueba de humo final.

### Requisitos de tu entorno local (una vez, antes del paso 1)
- `supabase start` corriendo (BD local en `127.0.0.1:54321`).
- `npm run dev` corriendo (web en `localhost:5173`).
- Para probar pagos: cuenta de Stripe en **modo test** y, para los pasos de webhook/reembolso, la Stripe CLI (`stripe listen --forward-to ...`) para reenviar eventos a tu local. Te daré el comando exacto cuando toque.

---

## Índice de pasos

| Paso | Apartado | Severidad | Toca producción-crítico |
|---|---|---|---|
| 0 | Preparación y red de seguridad | — | Rama base |
| 1 | Seguridad: cerrar fuga de PII (profiles/gardener_profiles) | 🔴 CRÍTICO | Migración RLS |
| 2 | Seguridad: blindar escritura directa de `bookings` | 🟠 ALTO | Migración RLS |
| 3 | Cobros: corregir precios mal calculados (palmeras/fito/herbicida) | 🔴 CRÍTICO | Motor de precios |
| 4 | Cobros: sistema de reembolso real | 🔴 CRÍTICO | Flujo de dinero |
| 5 | Cobros: robustez del webhook y vía de reserva | 🟠 ALTO | Flujo de dinero |
| 6 | Emails: fiabilidad del ciclo de reserva | 🔴 CRÍTICO | Edge functions |
| 7 | Reseñas: reputación visible al elegir jardinero | 🔴 CRÍTICO | Migración + front |
| 8 | Feature: cancelación de reserva por el cliente | 🟠 ALTO | Front + datos |
| 9 | Seguridad: cerrar funciones auxiliares (email/IA) | 🟠 ALTO | Edge functions |
| 10 | Limpieza: quitar debug/logs con PII del bundle | 🟠 ALTO | Build |
| 11 | Limpieza: borrar código muerto y archivos sueltos | 🟡 MEDIO/BAJO | Repo |
| 12 | Rendimiento y pulido: code-splitting, 404, navegación | 🟡 MEDIO | Front |
| 13 | Datos: barreras de config y huérfanos (candidato a semana 1) | 🟡 MEDIO | Motor/Storage |
| FINAL | Tus tareas manuales + subida a producción + prueba E2E | — | **Producción** |

> Los pasos 1–9 son los que convierten el veredicto en **GO**. Los 10–13 son los que dejan la web "limpia y rápida". La Fase Final es el despliegue.

---

## PASO 0 — Preparación y red de seguridad

**Qué haré (pre-borrador):**
- Crear rama `fix/pre-produccion` desde `main`.
- Confirmar el estado verde de partida: `npx vitest run` (deben seguir 356/356), `npm run lint`, `npm run build`.
- Anotar el número de migraciones actuales y hacer una copia de seguridad de la carpeta `supabase/migrations/` como referencia.

**Qué cambia para el usuario final:** nada (preparatorio).

**Antes de probar, TÚ:** nada.

**Prueba local:** ninguna — solo confirmo contigo que partimos de verde.

**⏸ ME DETENGO. Espero tu "avanza al paso 1".**

---

## PASO 1 — Cerrar la fuga de PII (profiles y gardener_profiles) 🔴

**Qué haré (pre-borrador):**
- Nueva migración `supabase/migrations/<timestamp>_revoke_anonymous_pii_access.sql` que:
  - `DROP POLICY` de las dos policies `SELECT USING(true)` de `profiles` y `gardener_profiles`.
  - `REVOKE SELECT ON public.profiles FROM anon;` y lo mismo para `gardener_profiles`.
  - Crear una **vista pública mínima** (p. ej. `public_gardener_directory`) con solo lo que el funnel necesita para mostrar jardineros a un visitante no logueado (nombre público, rating, distancia máx., coordenadas aproximadas), **sin** teléfono ni dirección exacta.
  - Repuntar en el front (ProvidersPage / perfil público) las lecturas que hoy dependen de la tabla abierta hacia la vista, si las hubiera.
- Aplicar la migración en local y verificar que el funnel sigue mostrando jardineros.

**Qué cambia para el usuario final:** ninguno visible. El cliente sigue viendo los jardineros con su nombre y rating; lo que desaparece es la posibilidad de que un tercero descargue teléfonos y direcciones con la clave pública.

**Antes de probar, TÚ:** nada (la migración se aplica sola en local con el comando que te daré).

**Prueba local (haz esto):**
1. Aplica la migración: `supabase migration up` (te confirmo el comando exacto).
2. **Prueba de la fuga (la importante):** con la web en local, ejecuta este `curl` (te daré la URL y la anon key locales ya rellenadas):
   `curl "http://127.0.0.1:54321/rest/v1/profiles?select=full_name,phone,address" -H "apikey: <ANON_LOCAL>"`
   - ✅ **Éxito:** devuelve `[]` o un error de permiso (antes devolvía filas con teléfonos).
3. **Prueba de no-regresión:** recorre el funnel en el navegador (`/reservar`) hasta el paso de elegir jardinero.
   - ✅ **Éxito:** los jardineros siguen apareciendo con nombre y valoración; no hay pantalla en blanco ni error en consola.
4. Repite el `curl` con `gardener_profiles`. ✅ igual: sin teléfono/dirección.

**⏸ ME DETENGO. Espero tu "avanza al paso 2".**

---

## PASO 2 — Blindar la escritura directa de `bookings` 🟠

**Qué haré (pre-borrador):**
- Migración que `REVOKE INSERT, UPDATE ON public.bookings FROM authenticated`, dejando la creación/actualización solo por los RPC `SECURITY DEFINER` que ya validan precio contra el presupuesto firmado.
- Si alguna lectura/actualización legítima del front dependía del UPDATE directo (p. ej. marcar algo), la redirijo al RPC correspondiente o añado un `WITH CHECK` que congele `total_price` y `status` salvo transiciones permitidas.

**Qué cambia para el usuario final:** ninguno visible. Se cierra la puerta a que alguien cree reservas con precio inventado o se marque una como "completada" saltándose el flujo, manipulando la API directamente.

**Antes de probar, TÚ:** nada.

**Prueba local (haz esto):**
1. Aplica la migración.
2. **No-regresión (camino feliz):** haz una reserva completa en local en modo test hasta el pago; debe crearse y aparecer en "Mis reservas".
   - ✅ **Éxito:** la reserva se crea con normalidad (porque va por el RPC, no por escritura directa).
3. **Prueba del blindaje:** te daré un `curl` que intenta `PATCH` directo de una reserva cambiando `total_price`.
   - ✅ **Éxito:** responde denegado por permisos.

**⏸ ME DETENGO. Espero tu "avanza al paso 3".**

---

## PASO 3 — Corregir los precios mal calculados 🔴

**Qué haré (pre-borrador):**
- **Guard `hasTreeOrPalm`** (bookingQuoteCore.ts): decidir el tipo de servicio por el **payload** (`palmGroups`/`treeGroups`) en vez de comparar slugs contra UUIDs. Así las palmeras "por hora" vuelven a pasar por el motor completo y cobran fitosanitario y pelado de tronco.
- **Fitosanitario manual vs IA:** en la rama sin métricas, derivar la tarifa desde `detailed_pricing` usando la intención real (preventivo/curativo) y el tipo afectado, en lugar del mapeo que hoy sobrecobra.
- **Herbicida:** decidir con la regla de negocio (probablemente eliminar la métrica del prompt/UI porque el desbroce ya lo cubre) para que no se cobre un concepto no pedido con tarifa equivocada.
- Añadir/ajustar tests unitarios del motor que fijen estos casos.
- ⚠️ **Dependencia de despliegue:** este paso toca `bookingQuoteCore.ts`, que comparten `booking-authority` y `booking-payment`. En local no importa; en la Fase Final habrá que **redesplegar esas dos funciones**. Lo anoto para el final.

**Qué cambia para el usuario final:** el presupuesto de palmeras por hora, fitosanitarios y herbicida pasa a ser correcto y coherente entre el camino de fotos y el manual.

**Antes de probar, TÚ:** nada.

**Prueba local (haz esto):**
1. Recorre el funnel de **Poda de palmeras** con un jardinero configurado "por hora" (te indico cómo dejar uno así en local si hace falta), activando un extra (p. ej. fitosanitario).
   - ✅ **Éxito:** el precio incluye el extra (antes lo ignoraba).
2. Recorre **Servicios fitosanitarios** por el camino manual y por el de fotos con los mismos datos.
   - ✅ **Éxito:** el precio es coherente entre ambos caminos (antes el manual sobrecobraba en preventivo).
3. `npx vitest run`. ✅ los tests del motor pasan.

**⏸ ME DETENGO. Espero tu "avanza al paso 4".**

---

## PASO 4 — Sistema de reembolso real 🔴

**Qué haré (pre-borrador):**
- Nueva edge function `booking-refund` (o ampliar `booking-payment`) que llame a `/v1/refunds` de Stripe sobre el `payment_intent_id` guardado en `pricing_context`, con idempotencia y registro del estado del reembolso en la reserva/attempt.
- Enganchar el reembolso automático en las transiciones que hoy dejan dinero cobrado sin servicio:
  - Jardinero **rechaza** la solicitud → refund.
  - Solicitud **caduca** a 24h → refund.
  - `reconciliation_required` con pago capturado → refund (o alerta + refund).
- Alternativa que evaluaré y te propondré: cambiar a **captura diferida** (`capture_method: manual`) y capturar solo cuando el jardinero acepta — así no hay que devolver nada porque no se cobra hasta que hay servicio. Te explico el trade-off antes de elegir.
- Tests del flujo de reembolso.

**Qué cambia para el usuario final:** si el jardinero rechaza o no responde, el cliente **recupera automáticamente** la comisión pagada. Se acaban los cobros por servicios que no se prestan.

**Antes de probar, TÚ:**
- Tener la **Stripe CLI** instalada y sesión en modo test. Te daré el comando `stripe listen --forward-to http://127.0.0.1:54321/functions/v1/booking-payment-webhook` para reenviar eventos a tu local.

**Prueba local (haz esto, en Stripe modo test — sin dinero real):**
1. Haz una reserva y paga con una tarjeta de test (`4242 4242 4242 4242`).
2. Desde el panel del jardinero (o simulando expiración), **rechaza** la solicitud.
   - ✅ **Éxito:** en el dashboard de Stripe (modo test) aparece un **refund** por el importe de la comisión, y la reserva queda `cancelled`.
3. Repite forzando el caso "pago ok pero reserva no se crea" (te doy la forma de provocarlo).
   - ✅ **Éxito:** se emite refund y queda registrado, no se queda dinero colgado.

**⏸ ME DETENGO. Espero tu "avanza al paso 5".**

---

## PASO 5 — Robustez del webhook y de la vía de reserva 🟠

**Qué haré (pre-borrador):**
- Webhook: dejar de tratar el estado `processing` como terminal — permitir reprocesar si supera un umbral de tiempo, apoyándome en la idempotencia ya existente de `confirm_booking_payment_attempt` (que es segura y no duplica).
- Vía de reserva duplicada: verificar si la vía "broadcast" (crear reservas sin pago) sigue viva; si está muerta, retirarla del flujo; si está viva, marcar el estado de pago para que `confirmed` no sea alcanzable sin PaymentIntent.

**Qué cambia para el usuario final:** ninguno visible; se elimina el caso raro de "pagué y no se creó la reserva" cuando el webhook se corta a mitad, y la ambigüedad de reservas confirmadas sin pago.

**Antes de probar, TÚ:** Stripe CLI como en el paso 4.

**Prueba local (haz esto):**
1. Con `stripe listen` activo, provoca una reserva pagada y, con el comando que te daré, **reenvía el mismo evento dos veces**.
   - ✅ **Éxito:** la reserva se crea **una sola vez**; el segundo evento se ignora sin error.
2. Te indicaré cómo simular un webhook interrumpido; al reintentarlo:
   - ✅ **Éxito:** la reserva acaba creándose (ya no queda atascada).

**⏸ ME DETENGO. Espero tu "avanza al paso 6".**

---

## PASO 6 — Fiabilidad del ciclo de emails 🔴

**Qué haré (pre-borrador):**
- Corregir el manejo de errores del dispatch de email en el webhook (comprobar el `{ error }` de `functions.invoke`, que hoy se traga los fallos).
- Fijar `verify_jwt`/secreto interno de `booking-confirmation-email` para que el webhook pueda invocarla sin que el gateway la rechace.
- Mover el email de "jardinero acepta/rechaza" a un punto **server-side** fiable (hoy sale del navegador del jardinero y se pierde si cierra la pestaña).
- Cablear el email de **cancelación** (hoy el tipo existe pero nadie lo invoca) y, opcionalmente, el de solicitud caducada.
- Corregir la CTA rota del email de rechazo de jardinero (`/apply`).
- ⚠️ El arreglo de fondo de "los emails no se envían en producción" es un problema de **despliegue**: las funciones correctas ya están en el repo pero la versión desplegada es vieja. El **redeploy** va en la Fase Final. Aquí dejo el código de emails correcto y robusto.

**Qué cambia para el usuario final:** cliente y jardinero reciben los emails correctos en cada momento del ciclo (reserva pagada, aceptación, rechazo, cancelación), y los fallos de envío dejan de ser invisibles.

**Antes de probar, TÚ:**
- Para probar envío real en local necesitas los **secrets de Brevo** (`SMTP_USER` = remitente verificado, `SMTP_PASS` = API key) cargados en tu Supabase local, o probamos en **modo MOCK** (la función registra el email que habría enviado sin mandarlo). Te recomiendo MOCK para local y dejar el envío real para la prueba E2E final. Te digo cómo levantar la función localmente.

**Prueba local (haz esto, modo MOCK):**
1. Levanta la función de emails en local (te doy el comando `supabase functions serve`).
2. Completa una reserva de test.
   - ✅ **Éxito:** en los logs de la función aparece el email de confirmación al **cliente y al jardinero** con los datos correctos (fecha formateada, precio correcto según destinatario).
3. Acepta y luego cancela una reserva.
   - ✅ **Éxito:** aparecen en los logs los emails de aceptación y de cancelación; ninguno se pierde en silencio.

**⏸ ME DETENGO. Espero tu "avanza al paso 7".**

---

## PASO 7 — Reputación visible al elegir jardinero 🔴

**Qué haré (pre-borrador):**
- Unificar el rating a **un solo par de columnas**. Lo correcto: un **trigger SQL** sobre la tabla `reviews` que recalcule `rating_average` y `rating_count` (las que lee la pantalla de elección) en cada nueva reseña, y un **backfill** para las reseñas ya existentes.
- Ajustar el front para que escritura y lectura usen las mismas columnas de forma consistente (ProvidersPage, BookingsList, perfil público).
- Que un jardinero sin reseñas muestre "Sin valoraciones"/"Nuevo" en vez de "5.0 (0 reseñas)".

**Qué cambia para el usuario final:** las valoraciones que dejan los clientes por fin se ven en la pantalla donde se elige jardinero. La prueba social funciona.

**Antes de probar, TÚ:** nada.

**Prueba local (haz esto):**
1. Aplica la migración (trigger + backfill).
2. Completa una reserva y **deja una reseña** de 5★ a un jardinero.
3. Inicia una reserva nueva y llega a la pantalla de elegir jardinero.
   - ✅ **Éxito:** ese jardinero muestra su valoración real (antes salía "Nuevo" siempre).
4. Un jardinero sin reseñas:
   - ✅ **Éxito:** muestra "Sin valoraciones", no "5.0".

**⏸ ME DETENGO. Espero tu "avanza al paso 8".**

---

## PASO 8 — Cancelación de reserva por el cliente 🟠

**Qué haré (pre-borrador):**
- Añadir en "Mis reservas" un botón **Cancelar** en estados `pending`/`confirmed`, que: cambie el estado a `cancelled` (vía RPC seguro, respetando el blindaje del paso 2), **libere el slot** de disponibilidad, dispare el **email** de cancelación (paso 6) y, si procede, el **reembolso** (paso 4).
- Definir contigo la política (¿reembolso total siempre, o según antelación?). Te propongo la más simple y justa y la confirmas.

**Qué cambia para el usuario final:** el cliente puede cancelar su reserva por sí mismo, con su reembolso, sin depender del jardinero ni del chat.

**Antes de probar, TÚ:** confirmarme la política de reembolso al cancelar (te doy una recomendación por defecto).

**Prueba local (haz esto):**
1. Con una reserva de test pagada, pulsa **Cancelar** en "Mis reservas".
   - ✅ **Éxito:** la reserva pasa a "Cancelada", el slot vuelve a quedar libre (compruébalo intentando reservar esa hora otra vez), aparece el refund en Stripe test y el email de cancelación en los logs.

**⏸ ME DETENGO. Espero tu "avanza al paso 9".**

---

## PASO 9 — Cerrar las funciones auxiliares inseguras 🟠

**Qué haré (pre-borrador):**
- `send-email-notification` y `booking-confirmation-email`: exigir autorización real del llamante (service_role interno o validación de propiedad del recurso) para que no se puedan usar como relay de correo con la clave pública.
- `ai-pricing-estimator`: exigir apikey allowlist + usuario, **rate limit** por usuario, y **restringir el `fetch` de imágenes** a los hosts del bucket del proyecto (cierra el coste ilimitado de Gemini y el SSRF).

**Qué cambia para el usuario final:** ninguno visible. Se cierra el abuso de envío de correos y el consumo malicioso de la IA.

**Antes de probar, TÚ:** nada.

**Prueba local (haz esto):**
1. **No-regresión:** haz un análisis de fotos con IA normal en el funnel (usuario logueado).
   - ✅ **Éxito:** sigue funcionando igual.
2. Te daré un `curl` que intenta invocar `send-email-notification` con un destinatario arbitrario sin autorización válida.
   - ✅ **Éxito:** responde denegado (antes habría enviado el correo).

**⏸ ME DETENGO. Espero tu "avanza al paso 10".**

---

## PASO 10 — Quitar debug y logs con PII del bundle 🟠

**Qué haré (pre-borrador):**
- Desmontar el componente `DatabaseFix` del panel admin y eliminarlo (hace escrituras de prueba a la BD desde el navegador).
- Retirar/gated las rutas de debug (`/debug-maps`, `/debug-roles`) para que su código no llegue al bundle.
- Eliminar los `console.log` que imprimen PII (email en reset, userId+email+rol, texto que teclea el cliente) y añadir `drop: ['console']` en la build de producción para eliminar el resto.

**Qué cambia para el usuario final:** ninguno visible. La consola del navegador en producción deja de exponer datos personales y desaparece una herramienta peligrosa del admin.

**Antes de probar, TÚ:** nada.

**Prueba local (haz esto):**
1. `npm run build` y revisa que compila.
2. Abre el admin en local.
   - ✅ **Éxito:** ya no aparece la sección "DatabaseFix".
3. Con la web en modo producción (te doy el comando `npm run preview`), abre DevTools → Consola y usa el reset de contraseña y el autocompletado de dirección.
   - ✅ **Éxito:** no se imprime tu email ni lo que tecleas.

**⏸ ME DETENGO. Espero tu "avanza al paso 11".**

---

## PASO 11 — Borrar código muerto y archivos sueltos 🟡

**Qué haré (pre-borrador):**
- Borrar (tras confirmar con grep que nadie los usa): componentes `TreePruning*`, `ServiceCatalog`, `ServiceDetail` (el del rating falso "4.8"), `useServiceData`, `roleLogger`, `BookingCheckoutPage`, la 2ª `Route "/"` inalcanzable, y los directorios vacíos.
- Limpiar la raíz del repo: mover los 3 scripts vivos a `scripts/`, borrar los ~25 archivos sueltos de diagnóstico (`check_*`, `fix_*`, `debug-*`, etc.), arreglar el script roto `seed:services`, sacar `dogfood-output/` del control de versiones.
- Verificar que `build` y `vitest` siguen verdes tras cada borrado.

**Qué cambia para el usuario final:** ninguno. El repo queda limpio y sin rutas fantasma como `/service/:id` con datos inventados.

**Antes de probar, TÚ:** nada.

**Prueba local (haz esto):**
1. `npx vitest run` y `npm run build`.
   - ✅ **Éxito:** ambos verdes; nada se rompió al borrar.
2. Navega la app por encima (home, funnel, admin).
   - ✅ **Éxito:** todo sigue igual de funcional.

**⏸ ME DETENGO. Espero tu "avanza al paso 12".**

---

## PASO 12 — Rendimiento y pulido de navegación 🟡

**Qué haré (pre-borrador):**
- **Code-splitting** con `React.lazy` de las zonas pesadas (admin, panel jardinero) para que el cliente que entra a reservar no descargue todo el bundle → carga más rápida en móvil.
- Añadir una ruta **catch-all 404** (hoy una URL desconocida deja la pantalla en blanco).
- Arreglar los botones "volver a elegir horario" que quedan **inertes** al volver de Stripe en `/reserva/confirmacion`.
- Corregir el copy público sin tildes ("jardineria" → "jardinería") y sustituir el fallback feo de imágenes de servicio por un placeholder de marca.

**Qué cambia para el usuario final:** la web carga más rápido en móvil, una URL mal escrita no deja pantalla en blanco, y al volver de un pago fallido se puede elegir otro horario.

**Antes de probar, TÚ:** nada.

**Prueba local (haz esto):**
1. `npm run build`.
   - ✅ **Éxito:** ahora hay varios chunks en vez de uno gigante.
2. Entra a una URL inventada (`/esto-no-existe`).
   - ✅ **Éxito:** redirige o muestra un 404, no una pantalla en blanco.
3. Simula volver de un pago a `/reserva/confirmacion` y pulsa "Elegir otro horario".
   - ✅ **Éxito:** te lleva al paso de horarios (antes no hacía nada).

**⏸ ME DETENGO. Espero tu "avanza al paso 13".**

---

## PASO 13 — Barreras de config y huérfanos (candidato a semana 1) 🟡

**Qué haré (pre-borrador):**
- Añadir barreras de elegibilidad que faltan (palmeras sin yields, árboles small/medium, endoterapia) para que un jardinero con configuración incompleta no cobre el mínimo ni bloquee mal el calendario.
- Aplicar los recargos de estado reales en `per_hour` (hoy usa multiplicadores fijos).
- Alinear los techos de plausibilidad manual con los de la IA.
- Job de limpieza de fotos huérfanas en Storage.

**Nota:** este paso es el menos urgente. Si prefieres salir a producción antes, se puede aplazar a la semana 1. Te lo marco para que decidas.

**Prueba local:** te la detallo si decidimos hacerlo antes de salir.

**⏸ ME DETENGO. Espero tu decisión (hacerlo ahora o aplazarlo).**

---

## FASE FINAL — Tus tareas manuales + subida a producción + prueba E2E

Cuando los pasos anteriores estén verdes en local, cerramos. Esta fase la hacemos **juntos y con tu aprobación por cada acción**, porque toca producción real.

### A) Tus tareas manuales (solo tú puedes hacerlas)
Te las detallo una a una cuando lleguemos, pero son:
1. **Plantillas de email de Auth** en el dashboard de Supabase (confirmación de registro, reset de contraseña, magic link) — personalizarlas con la marca GarSer. *(Panel Supabase → Authentication → Email Templates.)*
2. **Subir las 7 imágenes reales** de servicios al bucket `marketing-assets` en las rutas que te indicaré.
3. **Restringir la Google Maps API key** por dominio (referrer) y por API en Google Cloud, y **rotar la key histórica** que quedó en el git.
4. **Verificar los secrets de Brevo** en producción (`supabase secrets list`): `SMTP_USER` = remitente `@garser.es` verificado en Brevo, `SMTP_PASS` = API key. Sin esto los emails "funcionan" en falso (modo MOCK).
5. **Revisar la función `email-otp`** desplegada sin código en el repo y borrarla si está muerta.

### B) Subida a producción (con tu OK por cada una)
1. `git push` de la rama y merge a `main`.
2. **Aplicar las migraciones** a la BD de producción (las de los pasos 1, 2, 7). Antes: backup de la BD de producción.
3. **Redesplegar las edge functions** con `--use-api` (Docker cuelga en tu máquina): el webhook y los emails (paso 6), el motor via `booking-authority` + `booking-payment` (paso 3), reembolso (paso 4), auxiliares endurecidas (paso 9).
4. Configurar en Stripe **producción** el endpoint del webhook y su secreto de firma.
5. Desplegar el front (Vercel) con las variables de entorno de producción.

### C) Prueba de humo E2E (final)
1. Primero **en modo test** de Stripe de punta a punta: reservar → pagar → recibir email → cancelar → ver reembolso.
2. Luego **una** transacción con **dinero real mínimo** en producción para confirmar que el cobro, el email y el reembolso funcionan con las claves reales. Esta es la única prueba con dinero real y la hago contigo.

**Criterio de GO definitivo:** los 5 bloqueantes verificados en local + tus 5 tareas manuales hechas + la prueba E2E en test verde + la prueba de humo real correcta.

---

## Nota final
Cada vez que un paso toque `bookingQuoteCore.ts` (paso 3) o cualquier edge function (pasos 4, 5, 6, 9), lo apunto en una lista de "pendiente de redesplegar" que ejecutamos junta en la Fase Final. Así nada queda a medias entre local y producción.
