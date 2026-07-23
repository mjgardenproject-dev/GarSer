# Prompt 07 — Botón "Usar mi ubicación actual": ✅ HECHO — solo checklist de producción

> Sesión nueva, en frío. Proyecto **GarSer** (React+Vite+TS, Google Maps JS API). Item **ya resuelto y verificado en vivo** el 2026-07-10 (resolvió una dirección real en Málaga y guardó coordenadas). Esta sesión es solo verificación de producción; no reimplementar nada.

## Lo que ya está hecho (verificado 2026-07-11, comprueba con `git log` si está commiteado)

En `src/pages/reserva/AddressPage.tsx` (`handleUseCurrentLocation`, líneas ~26-70):

1. ✅ `navigator.geolocation.getCurrentPosition` → `getAddressFromCoordinates(lat,lng)`
   (`src/utils/geolocation.ts:73-102`, Geocoder de Google Maps).
2. ✅ **Coordenadas se guardan aunque el reverse geocoding falle** — no se bloquea la
   reserva; solo se pide completar el texto de la dirección.
3. ✅ **Mensajes de error por tipo**: permiso denegado / sin señal GPS / timeout / genérico,
   cada uno con instrucción de recuperación.
4. ✅ **Validación del número de casa relajada**: si ya hay `addressCoordinates` (ubicación
   actual o autocompletado) no se exige número; solo se pide cuando la dirección se teclea
   a mano sin coordenadas (líneas ~76-84).
5. ✅ `isLocating` se resuelve en `finally` y en el callback de error (el botón no se queda
   colgado en "Obteniendo ubicación…").

## Checklist de producción (lo único pendiente)

- [ ] **API key de Google Maps** (`VITE_GOOGLE_MAPS_API_KEY`): en producción debe tener
      habilitadas las APIs **Geocoding** y **Places** y las restricciones de referrer deben
      incluir `garser.es` (y `www.garser.es`). Sin esto, el Geocoder devuelve
      `REQUEST_DENIED` y el botón caerá al mensaje de error de geocoding.
- [ ] **HTTPS**: `navigator.geolocation` solo funciona en origen seguro. garser.es sirve
      todo por https (localhost cuenta como seguro en dev).
- [ ] Confirmar que las coordenadas guardadas se usan aguas abajo para filtrar jardineros
      por distancia (`calculateDistance`, `geolocation.ts:4`) — una reserva geolocalizada
      debe mostrar los mismos jardineros que la misma dirección tecleada.
- [ ] Prueba en móvil real (el caso de uso principal): permiso → dirección rellenada →
      continuar sin exigir número.

## Pulido adicional detectado (2026-07-11, con la web en vivo a 375px)

La página carga limpia y el funnel avanza sin errores de consola, pero quedan mejoras
pequeñas y de bajo riesgo en `AddressPage.tsx`:

1. **El CTA "Continuar a servicios" no tiene estado de carga**: `validateAndContinue` hace
   `await getCoordinatesFromAddress(...)` (`:87-90`) sin spinner ni disabled — con red móvil
   lenta el botón parece muerto y el usuario lo machaca. Añadir estado `isValidating`.
2. **Coordenadas del autocompletado desaprovechadas**: `handleAddressSelected` pone
   `addressCoordinates` a `null` siempre (`:20-24`), aunque el comentario de
   `validateAndContinue` (`:76-78`) asume que la selección del autocompletado trae coords.
   Si `AddressAutocomplete` puede devolver el place con geometría, capturarla ahí y ahorrar
   el geocode posterior (y hacer verdadera la exención del número de casa).
3. **`saveProgress()` en cada tecla**: el `useEffect` con dependencia `[address]` (`:16-18`)
   guarda el progreso en cada pulsación. Debounce o guardar solo al validar/continuar.
4. **📱 Doble cabecera**: en 375px se apilan la navbar de marketing (logo + "Iniciar
   sesión") y la cabecera del funnel (volver + "Dirección" + "Salir") — dos filas que roban
   ~130px a la primera pantalla del funnel. Ocultar la navbar de marketing dentro de
   `/reserva` (el funnel ya tiene sus propios controles de salida).
5. **📱 Confirmación visual (conversión)**: tras geolocalizar o seleccionar dirección,
   mostrar un mini-mapa estático con el pin (Google Static Maps con la key existente) —
   confirma al usuario que el punto es correcto antes de continuar y reduce direcciones mal
   geolocalizadas aguas abajo (el filtrado de jardineros por distancia depende de esas coords).

## Verificación

`npm run dev`: pulsar el botón, aceptar permiso → campo relleno y se puede continuar; denegar permiso → mensaje específico; simular fallo de geocoding (desconectar red tras obtener posición) → coords guardadas + aviso de completar dirección. En producción: revisar consola/network que el geocoding responde OK sin `REQUEST_DENIED`.

## Restricciones

- No tocar `AddressAutocomplete` (`src/components/common/AddressAutocomplete`) ni duplicar loaders de Google Maps (`src/lib/googleMapsLoader.ts`).
