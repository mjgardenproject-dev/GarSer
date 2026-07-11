# Prompt 08 — Tarjetas de servicio del jardinero: detalle IA, acciones móviles y paridad en confirmadas

> Sesión nueva, en frío. Proyecto **GarSer** (React+Vite+TS, Tailwind 3, Lucide). Para saber **qué variables definen cada servicio**, invoca la skill **`garser-ai-analysis-flows`** o **`reglas-de-pricing`**. NOTA: la skill `diseno-web-cliente` es SOLO para páginas de cliente; estas tarjetas son de cara al **jardinero** — no usarla.

## Estado actual (verificado 2026-07-11) — el bloque "Detalle del servicio" YA existe para reservas manuales

Añadido el 2026-07-10 a `src/components/gardener/BookingRequestsManager.tsx` (comprueba `git log`):

- Bloque "Detalle del servicio" en solicitudes pendientes (líneas ~553-590): duración,
  badge de modo de datos, retirada de restos y variables legibles por item
  (`FIELD_LABELS`/`VALUE_LABELS` + `describeDeclaredItem`, líneas ~61-106).
- Las variables se cargan con `fetchDeclaredVariables` **solo si `data_input_mode === 'manual'`**
  (líneas ~286-302).
- Fotos del cliente: en pendientes (`media_urls`) y en confirmadas
  (`GardenerBookings.tsx:221-232`, máx. 8 miniaturas que abren en pestaña nueva).

## 🐞 Hueco principal: las reservas por FOTOS (IA) siguen "a ciegas"

Cuando `data_input_mode !== 'manual'` la tarjeta dice "Analizado por IA (fotos)" pero **no
muestra ninguna variable** (m², nº de palmeras, especie/altura, estado…). Los datos existen
(`pricing_context` ya viene en el query, `BookingRequestsManager.tsx:260`, y/o el análisis IA
guardado) — extraerlos y renderizarlos con el mismo formato de ficha, ampliando
`FIELD_LABELS`/`VALUE_LABELS` con los campos que falten (especie de palmera, banda de altura,
métricas fito, caras de setos…).

## ❓ FALTA en `GardenerBookings.tsx` (confirmadas) — verificado 2026-07-11

1. **Confirmación antes de "Servicio Completado"**: el botón (`GardenerBookings.tsx:201-209`)
   completa la reserva **de un solo toque** y dispara la limpieza de fotos
   (`completeBookingAndCleanupMedia`) — en móvil un toque accidental es irreversible.
   Añadir diálogo de confirmación.
2. **Errores silenciosos**: `updateBookingStatus` solo hace `console.error`
   (`:83-85`) — el jardinero no se entera si falla. Añadir toast de error/éxito.
3. **Teléfono del cliente y "Cómo llegar"**: la tarjeta muestra la dirección como texto
   plano (`:183-186`). Un jardinero en móvil necesita **llamar al cliente** (`tel:` link) y
   **navegar** (link a Google Maps con la dirección/coords:
   `https://www.google.com/maps/dir/?api=1&destination=...`). Hoy no existe ninguno de los dos.
4. **Bloque "Detalle del servicio"**: no existe en confirmadas — extraer el de
   `BookingRequestsManager` a un componente compartido (p. ej. `ServiceDetailCard.tsx`) y
   usarlo en ambas vistas.
5. **Indicador "+N fotos"**: se cortan en 8 sin avisar (`:225`).
6. **Tipado**: `(booking as any).media_urls` → añadir `media_urls` al tipo `Booking`.

## 🗑️ SOBRA / revisar

- El grid de metadatos `md:grid-cols-4` de `GardenerBookings` (`:174`) en desktop reparte
  fecha/hora/dirección/precio en 4 columnas donde la dirección se trunca — en móvil apila
  bien; simplificar a una ficha de 2 columnas coherente con la tarjeta de pendientes.

## 📱 Diseño móvil (los jardineros trabajan desde el móvil)

- **Galería con lightbox**: miniaturas actuales abren pestaña nueva → visor interno con
  zoom/deslizar y contador ("3/5"), tanto en pendientes como en confirmadas.
- Botones de acción (Aceptar/Rechazar/Chat/Completado) a ancho completo apilados en <400px,
  con altura táctil ≥44px; hoy van en fila con `flex-wrap` y pueden quedar diminutos.
- La tarjeta de pendientes es larga (detalle + fotos + notas + propuesta de precio):
  valorar colapsar secciones secundarias (notas, propuesta de precio) en acordeones.
- Estados con color + icono (no solo color) para legibilidad al sol.

## Qué NO tocar

- La lógica de aceptar/rechazar (`respondBookingRequest`) y la de proponer/recalcular precio
  (incluida la guarda de palmeras `allows_price_change`, `BookingRequestsManager.tsx:370/630/665`).
- El botón "Recalcular con las medidas reales" (`ManualEntryWizard`) de reservas manuales.
- El motor de precios ni el esquema, salvo exponer un dato ya guardado.

## Verificación

`npm run dev` como jardinero (viewport 375px) con una reserva de cada servicio **en ambos modos** (manual y fotos): la tarjeta muestra las variables correctas + fotos con lightbox; confirmadas muestran el mismo detalle + botones llamar/navegar funcionales (`tel:` y Maps abren); "Completado" pide confirmación y muestra toast; reservas sin fotos/variables se ven limpias.

## Restricciones

- Reutilizar helpers existentes (`fetchDeclaredVariables`, `fetchBookingMediaMap`, `resolveManualServiceKey`); extraer los formateadores a un módulo compartido en vez de duplicarlos.
