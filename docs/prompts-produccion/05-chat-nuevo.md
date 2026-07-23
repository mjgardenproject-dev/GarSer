# Prompt 05 — Chat nuevo (mobile-first): rediseño completo sobre la base de mensajes de sistema

> Sesión nueva, en frío. Proyecto **GarSer** (React+Vite+TS, Supabase Realtime + Storage). Apóyate en la skill **`supabase`** para Realtime/RLS/tablas.

## Estado actual (verificado 2026-07-11) — los mensajes de sistema YA tienen infraestructura

El 2026-07-10 se construyó la capa server-side de mensajes automáticos (comprueba con `git log` si está commiteada):

- **Migración `supabase/migrations/20260710120000_chat_system_messages.sql`** —
  ⚠️ **PENDIENTE DE APLICAR** (`supabase db push`). Añade columna `message_type ('user'|'system')`,
  `sender_id` nullable, y trigger sobre `bookings` que inserta mensajes con **nombres reales**
  tras: solicitud, aceptación, cancelación/rechazo y propuesta/aceptación/rechazo de cambio de
  precio. Server-side, no spoofeable.
- **`ChatWindow.tsx` ya renderiza** los mensajes de sistema (píldora centrada) y tolera `sender_id null`.

**Primer paso de esta sesión**: aplicar la migración y verificar en vivo que al crear/aceptar/cancelar una reserva aparecen los mensajes.

## Componentes actuales a reemplazar

`src/components/chat/ChatWindow.tsx` (~490 líneas, modal `fixed inset-0`) y `src/components/chat/ChatList.tsx` (~282 líneas). Puntos de entrada: ruta `/chat` (`App.tsx:446`), `GardenerDashboard.tsx`, `GardenerBookings.tsx`, `src/components/client/BookingsList.tsx`. Tabla `chat_messages`. Realtime: canal `chat_${bookingId}` por INSERT y `booking_meta_${bookingId}` por UPDATE de `bookings`.

## 🐞 Bugs y funciones ROTAS del chat actual (verificados 2026-07-11)

1. **Cambio de precio cojo dentro del chat**: el jardinero propone desde el chat
   (`submitPriceProposal`), pero los botones del cliente para aceptar/rechazar NO existen:
   `respondToPriceProposal` (`ChatWindow.tsx:293`) e `isClient` (`:317`) están definidos y
   **sin usar**. El cliente solo puede responder desde `BookingsList.tsx:284`, y el mensaje
   de sistema de la migración le dice "puedes aceptarlo o rechazarlo desde el chat" →
   **cablear la tarjeta de propuesta con botones** (el servicio existe:
   `respondBookingPriceChange`, `bookingPriceChangeService.ts:33`).
2. **Bug SQL de leídos con mensajes de sistema**: `markMessagesAsRead` filtra con
   `.neq('sender_id', user.id)` (`ChatWindow.tsx:131`) y en SQL `NULL != x` no matchea →
   los mensajes de sistema **jamás se marcan como leídos**. `ChatList` cuenta no-leídos con
   el mismo `.neq` (`ChatList.tsx:115`) → hoy quedan excluidos del badge. Decidir la
   semántica correcta (un evento de sistema debería contar como no leído y marcarse al
   abrir el chat) e implementarla coherente en ambos sitios.
3. **Posible duplicado de mensajes**: `fetchMessages` + suscripción Realtime pueden
   solaparse y no hay deduplicación por `id` al hacer append (`ChatWindow.tsx:176`).

## 🗑️ SOBRA (ineficiencias a no arrastrar al chat nuevo)

- **Query de perfil por CADA mensaje entrante** en Realtime (`ChatWindow.tsx:167-175`).
  En un hilo solo hay 2 participantes: precargar nombres una vez.
- **N+1 en `ChatList`**: 2 queries por reserva (último mensaje + count de no leídos,
  `ChatList.tsx:102-116`) — con 30 reservas son 60 requests. Sustituir por un RPC/consulta
  agregada única.
- **Fetch del hilo completo sin paginación** (`ChatWindow.tsx:83-87`): un chat largo con
  imágenes carga todo de golpe.

## ❓ FALTA (funciones que un chat de producción necesita)

- **Envío optimista**: hoy el mensaje propio no aparece hasta que vuelve por Realtime →
  lag perceptible en móvil. Insertar localmente con estado "enviando" y reconciliar.
- **Previsualización de la imagen antes de enviar** (hoy solo el nombre del archivo,
  `ChatWindow.tsx:454-458`) + **compresión client-side** (una foto de móvil son varios MB)
  + indicador de subida con progreso.
- **Separadores de fecha** entre días (hoy solo `HH:mm` en burbujas: un hilo de varios días
  es ambiguo) y agrupación de mensajes consecutivos del mismo autor.
- **Realtime de la lista**: los contadores/último mensaje de `ChatList` solo se refrescan al
  cerrar un chat (`closeChat → fetchChats`, con spinner full-page → parpadeo). Suscripción
  a INSERTs del usuario y actualización in-place.
- **Botón atrás de Android/iOS**: el chat es un modal sin integración con el historial —
  "atrás" saca al usuario de la página entera en vez de cerrar el chat. Empujar una entrada
  al history al abrir y cerrarla en `popstate` (o convertir el chat en ruta `/chat/:bookingId`).
- **Estado de conexión**: si el canal Realtime se cae no hay aviso ni reintento.
- **Nota**: el filtro de `ChatList` que oculta reservas `pending` sin mensajes
  (`ChatList.tsx:134-136`) quedará obsoleto al aplicar la migración (toda reserva tendrá
  mensaje de sistema desde el INSERT) — revisar qué conversaciones deben listarse.

## 📱 Diseño móvil del chat nuevo

- Mantener full-screen `h-[100dvh]` + safe-area (ya existe, `ChatWindow.tsx:326-329/453`) y
  el input `text-base` (evita zoom de iOS) — conservar.
- Burbujas con `max-w-[80%]` en vez del actual `max-w-xs` fijo (`:420`).
- Gestión del teclado: al abrirse, mantener el último mensaje visible (API `visualViewport`
  o `scrollIntoView` tras el resize) y no perder el foco del input al enviar.
- El formulario de propuesta de precio del jardinero hoy vive DENTRO del scroll de mensajes
  (`:360-395`) y se pierde al scrollear — moverlo a una acción fija del header (botón "€")
  que abre un sheet.
- Textarea auto-expandible (1→4 líneas) en lugar del input de una línea.
- Imagen en burbuja: abrir en lightbox interno, no en pestaña nueva (`:427`).

## Qué construir

- [ ] **Capa de servicio** (`src/utils/chatService.ts`): fetch paginado, envío optimista,
      marcado de leído (con la semántica de sistema corregida), suscripción con nombres
      precargados y dedupe por id.
- [ ] **UI nueva** lista + ventana con todo lo anterior; tarjeta de propuesta de precio con
      Aceptar/Rechazar para el cliente, consistente con `BookingsList` (una sola fuente:
      `price_change_status` de `bookings`).
- [ ] **Contador de no leídos** coherente en los 4 puntos de entrada (badge en `BottomNav`
      si aplica).
- [ ] **Eliminar de verdad** el código viejo y actualizar los 4 puntos de entrada.

## Verificación

Aplicar migración → `npm run dev` con dos sesiones (cliente y jardinero) en viewport 375px: crear reserva → mensaje de sistema; aceptar/cancelar → mensajes con nombres reales; proponer precio desde el chat del jardinero → el cliente acepta **desde el chat** y el precio cambia; enviar texto e imagen (preview + compresión); botón atrás cierra el chat, no la página; contador de no leídos se actualiza sin recargar.

## Restricciones

- Conservar las guardas de `booking_price_change` y la telemetría (`reportBookingEvent`).
- Cambios de esquema → migración + RLS revisada (skill `supabase`). RLS de `chat_messages` debe permitir leer mensajes con `sender_id NULL` a ambos participantes.
- Guarda el diseño en memoria (`.../memory/chat-rediseno.md`) e indéxalo en `MEMORY.md`.
