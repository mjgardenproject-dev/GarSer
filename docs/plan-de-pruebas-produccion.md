# Plan de pruebas — cierre de la implementación de producción (2026-07-11)

Verifica los 8 apartados ejecutados (commits `f4e64fd` … `8e669eb`). Cada punto tiene la
**acción** y el **resultado esperado**. Marca la casilla solo si el resultado se cumple tal cual.

## 0 · Preparación (una sola vez)

- [ ] **Dos cuentas de prueba**: una de CLIENTE y una de JARDINERO aprobado (con al menos un
      servicio configurado con precios). Ideal: dos navegadores distintos (o normal + incógnito)
      con una sesión cada uno.
- [ ] **Dispositivo móvil real** (o DevTools en 375×812) para todas las pruebas marcadas con 📱.
- [ ] **Secrets de email en Supabase**: `SMTP_USER` (remitente verificado en Brevo) y
      `SMTP_PASS` (api-key). Sin ellos los emails van en modo MOCK (solo logs) — las pruebas
      de email requieren tenerlos puestos.
- [ ] Acceso al **Dashboard de Supabase** (logs de Edge Functions y SQL editor).

### Verificación de infraestructura (SQL editor de Supabase)

- [ ] `select column_name from information_schema.columns where table_name='chat_messages' and column_name='message_type';` → devuelve 1 fila.
- [ ] `select * from pg_tables where tablename='chat_thread_reads';` → existe.
- [ ] `select proname from pg_proc where proname in ('chat_overview','get_booking_service_details','post_booking_system_message');` → devuelve las 3.
- [ ] En **Edge Functions** del Dashboard: `booking-authority`, `send-email-notification` y
      `booking-confirmation-email` con fecha de deploy 2026-07-11.

---

## 1 · Disponibilidad (jardinero → cliente)

Como JARDINERO en `/dashboard` → Gestión de Disponibilidad:

- [ ] La semana carga rápido y sin parpadeos (una sola consulta, sin console.logs).
- [ ] 📱 La leyenda (Disponible / Reservado / **Solicitada** / No disponible) se ve ENCIMA del calendario.
- [ ] Marca varias horas, incluida la de las **7:00**. Aparece el botón **Guardar sticky abajo**
      📱 al haber cambios. Guarda → toast de éxito → recarga la página → todo persiste.
- [ ] Cambia de pestaña (Horario fijo ↔ Ajustes puntuales) con cambios sin guardar → modal de confirmación.
- [ ] Horario fijo (recurrente): define plantilla, guarda, recarga → persiste y genera semanas futuras.
- [ ] 📱 Las celdas del calendario móvil son cómodas de tocar (44px de alto).

Como CLIENTE (funnel de reserva con dirección cercana al jardinero):

- [ ] El slot de las **7:00** que marcó el jardinero se ofrece al reservar.
- [ ] Completa una reserva con pago → como jardinero, esa franja aparece **Reservado** (verde
      oscuro) si la aceptas, o **Solicitada** (ámbar) mientras esté pendiente.
- [ ] Las celdas ámbar (solicitud pendiente) **no se pueden desmarcar**.
- [ ] Con otro cliente (u otra sesión), la franja ocupada **ya no se ofrece**.
- [ ] Cancela/rechaza la reserva → la franja vuelve a ofrecerse.

## 2 · Cálculo de tiempos

- [ ] Haz una reserva de cada servicio (o al menos césped, palmeras y fitosanitarios, los 3
      motores distintos) y anota: horas del resumen del cliente, horas de la tarjeta del
      jardinero ("Duración estimada") y nº de franjas bloqueadas en su calendario.
      **Las tres cifras deben coincidir.**
- [ ] El precio del checkout coincide con el que muestra la tarjeta del jardinero.

## 3 · Chat nuevo 📱 (dos sesiones a la vez: cliente y jardinero)

Mensajes automáticos de sistema (server-side):

- [ ] Al crear una reserva → en el chat aparece la píldora gris "Reserva solicitada: {servicio}…".
- [ ] Jardinero acepta → "{nombre} ha aceptado la reserva…". Cancela/rechaza → mensaje de cancelación.
- [ ] Los mensajes de sistema usan **nombres reales**, salen centrados y sin burbuja.

Cambio de precio EN el chat:

- [ ] Como jardinero (reserva pendiente): botón **€** en la cabecera → panel de propuesta →
      envía nuevo precio con motivo.
- [ ] Como cliente: aparece la tarjeta ámbar FIJA bajo la cabecera con botones **Aceptar / Rechazar**.
      Acepta → toast, el precio de la reserva cambia y aparece el mensaje de sistema "Nuevo precio aceptado".

Mensajería:

- [ ] Envía un texto → aparece **al instante** (estado "Enviando…" → hora) sin esperar al servidor.
- [ ] Adjunta una foto grande (3–10 MB) → se ve la **previsualización antes de enviar** (con X
      para quitarla), sube en pocos segundos (compresión) y en la burbuja se abre en **visor
      interno** (no pestaña nueva).
- [ ] Escribe varias líneas → el campo crece (hasta 4 líneas). Enter envía; Shift+Enter salto de línea.
- [ ] Con mensajes de días distintos → separadores "Hoy" / "Ayer" / fecha.
- [ ] El otro usuario abre el chat → tus mensajes pasan de "Enviado" a **"Leído"** en vivo.
- [ ] 📱 **Botón atrás del móvil** con el chat abierto → cierra el chat, NO te saca de la página.
- [ ] 📱 Con el teclado abierto, el último mensaje sigue visible y el input no se tapa.
- [ ] Activa modo avión unos segundos → banner "Reconectando…"; al volver la conexión desaparece.
- [ ] En un hilo con más de 50 mensajes → botón "Mensajes anteriores" carga el histórico sin saltos de scroll.

Lista de chats:

- [ ] Recibe un mensaje con la lista abierta → el hilo sube, el último mensaje y el **badge verde**
      de no leídos se actualizan **sin recargar ni parpadear**.
- [ ] Los mensajes de sistema **cuentan** como no leídos (crea una reserva y mira el badge del otro usuario).
- [ ] Abre el chat y ciérralo → el badge se pone a cero sin spinner de página completa.

## 4 · Tarjetas de servicio del jardinero 📱

Solicitudes pendientes (con una reserva POR FOTOS y otra MANUAL):

- [ ] Reserva por fotos (IA): el bloque "Detalle del servicio" muestra las **variables del
      trabajo** (m², especie/altura de palmeras, caras de setos, métricas fito…) con la
      etiqueta "Analizado por IA (fotos)".
- [ ] Reserva manual: mismas fichas con "Declarado por el cliente".
- [ ] Fotos del cliente: cuadrícula con **"+N"** si hay más de 4, y el toque abre el **visor**
      con flechas y contador ("2/5").
- [ ] Aceptar/rechazar y proponer precio siguen funcionando igual que antes.

Reservas confirmadas ("Mis Reservas"):

- [ ] Cada tarjeta tiene **Llamar** (abre el marcador con el teléfono del cliente),
      **Cómo llegar** (abre Google Maps con la dirección) y **Chat**.
- [ ] Aparece el mismo bloque "Detalle del servicio" que en pendientes.
- [ ] "Servicio Completado" → **pide confirmación** en un diálogo; confirma → toast de éxito y
      la reserva pasa a Completada. (Prueba también cancelar el diálogo.)
- [ ] Prueba sin red: completar falla → **toast de error** (no fallo silencioso).

## 5 · Formulario "Quiero ser jardinero" 📱 (`/apply`)

- [ ] Teléfono: teclado numérico en móvil; "12345" → error inline rojo y no deja continuar;
      "600 11 22 33" o "+34 600112233" → válido.
- [ ] Con el botón "Siguiente" deshabilitado, debajo aparece la **pista de qué falta**.
- [ ] Los 7 servicios en el paso 2, **incluido "Desbroce de malas hierbas"**.
- [ ] Sube una foto de móvil grande → sube en segundos (comprimida). En modo avión → toast de error.
- [ ] Recarga a mitad del wizard → se restauran paso y respuestas (autosave).
- [ ] La barra de progreso marca **100% en el paso 6**.
- [ ] Envía la solicitud → página de estado "pendiente". El borrador local queda limpio
      (DevTools → Application → localStorage: sin `gardener_wizard_progress_…`).
- [ ] Desde el admin, rechaza la solicitud → email de rechazo con motivo → "Volver a solicitar"
      permite corregir y reenviar.

## 6 · Dirección y ubicación 📱 (`/reserva`)

- [ ] Dentro del funnel **no hay navbar de marketing** (solo la cabecera con Volver/Salir):
      pantalla completa para el contenido.
- [ ] "Usar mi ubicación actual" + permitir → el campo se rellena con tu dirección real y las
      coordenadas quedan guardadas. Continuar funciona **sin exigir número de casa**.
- [ ] Deniega el permiso → mensaje específico de permiso (no genérico).
- [ ] Escribe y **selecciona una sugerencia** del autocompletado → "Continuar" avanza rápido
      (sin re-geocodificar) y sin exigir número.
- [ ] Escribe una dirección a mano SIN número → aviso "incluye el número de la casa".
- [ ] Con red lenta (DevTools → throttling "Slow 3G"), tras escribir a mano y continuar → el
      botón muestra **"Validando dirección…"** y no responde a dobles toques.

## 7 · Emails automáticos (con SMTP configurado; revisar en móvil y en modo oscuro)

- [ ] Paga una reserva (queda `pending`) → **cliente**: "Hemos recibido tu reserva" (¡NO dice
      "confirmada"!); **jardinero**: "Nueva solicitud de reserva". Ambos con plantilla verde
      GarSer, nombre real y botón a garser.es.
- [ ] El jardinero **acepta** → email al cliente "¡Tu reserva ha sido aceptada!" con el nombre
      del jardinero y detalles (servicio/fecha/total).
- [ ] El jardinero **rechaza** → email "no ha podido ser aceptada" con CTA "Buscar otro profesional".
- [ ] En Gmail: los tres emails tienen **versión de texto plano** (menú ⋮ → Mostrar original →
      buscar `text/plain`).
- [ ] Aprueba una solicitud de jardinero desde el admin → email de bienvenida con la plantilla de marca.
- [ ] 📱 Abre los emails en el móvil: botón CTA cómodo de pulsar, sin desbordes; revisa también en modo oscuro.

## 8 · Configuración de precios del jardinero

- [ ] En cualquier configurador, intenta teclear un valor negativo → **imposible** (el signo no entra).
- [ ] Pon un recargo a **0** explícitamente, guarda, recarga → sigue en 0 (no vuelve al default),
      y una reserva con estado "descuidado" NO aplica recargo.
- [ ] Cambia un rendimiento (p. ej. `m²/hora` de césped), guarda → una reserva nueva mueve
      **a la vez** el precio y las horas de forma coherente.

## 9 · Regresión técnica (terminal)

- [ ] `npx vitest run` → **356/356**.
- [ ] `npm run build` → verde.
- [ ] `grep -rn "mergedAvailabilityService\|bufferService\|MergedSlotsSelector\|TimeBlockSelector" src/` → sin resultados (código muerto fuera).
- [ ] Consola del navegador limpia (sin errores rojos) al recorrer funnel, chat y panel del jardinero.

## 10 · Pendientes manuales (hacer + verificar; no eran automatizables desde código)

- [ ] **Plantillas de Supabase Auth** (Dashboard → Auth → Email Templates): personalizar
      verificación y reset con marca GarSer → probar enviándote un reset de contraseña.
- [ ] **Imágenes de servicios**: subir imagen a cada fila de la tabla `services` (solo setos
      tiene) → el paso 2 del funnel deja de mostrar "Imagen no disponible".
- [ ] **API key de Google Maps** (producción): Geocoding + Places habilitados y referrers
      `garser.es` / `www.garser.es` → el botón de ubicación y el autocompletado funcionan en
      el dominio real sin `REQUEST_DENIED` en la pestaña Network.
- [ ] Decisión de producto pendiente: ¿**buffer de desplazamiento** entre trabajos consecutivos
      de un jardinero? Hoy no existe (solo existía en código muerto). Si se quiere, va en
      `booking-authority`.
