# Smoke manual del pipeline de fotos de reserva

## Estado

- Fecha: `2026-05-18`
- Entorno: local `http://127.0.0.1:4174`
- Backend validado contra Supabase real del proyecto

## Evidencia automatizada ejecutada

- `npx vitest run`
  - Resultado: `30/30` archivos en verde, `141/141` tests pasando.
- `npm run build`
  - Resultado: compilación de producción correcta.
  - Warning no bloqueante existente: chunk principal > `1000 kB`.

## Smoke manual sin sesión

- Wizard oficial `/reservar` accesible desde home sin errores de navegación.
- Dirección manual aceptada y transición a selección de servicio validada.
- Servicios revisados en detalles:
  - `Corte de césped`
  - `Corte de setos a máquina`
  - `Poda de árboles`
  - `Poda de palmeras`
  - `Poda de plantas y arbustos`
  - `Servicios fitosanitarios`
- `Corte de setos a máquina` revalidado en esta pasada:
  - creación de zona,
  - render de flujo por caras,
  - aviso de `Cara A` obligatoria,
  - CTA de análisis bloqueado hasta completar prerrequisitos.
- Consola del navegador sin errores de ejecución atribuibles al refactor.
- Red con respuestas correctas de servicios/configuración; sin fallos críticos del wizard.

## Smoke manual con sesión autenticada

- Login real completado con usuario de prueba proporcionado por negocio.
- Evento `SIGNED_IN` observado en cliente y navegación autenticada correcta.
- Wizard retomado tras autenticación sin corrupción del draft.
- El usuario de prueba disponible en el IDE entra con rol `client`, por lo que no permite cerrar un E2E real de panel jardinero desde el navegador integrado.
- Se valida igualmente en navegador:
  - restauración de sesión,
  - continuidad del wizard autenticado,
  - ausencia de errores críticos nuevos en consola,
  - ausencia del ruido repetitivo previo de `booking-telemetry`.
- Consola sin errores críticos del flujo autenticado.
- Red con autenticación Supabase correcta (`token`, `user`, `profiles`).

## Validación del cleanup terminal

- La transición `completed -> cleanup` queda cubierta dentro del IDE por:
  - wiring de frontend hacia `completeBookingAndCleanupMedia`,
  - test unitario de `bookingCompletionService`,
  - hardening de lectura en `bookingMediaService` para no resucitar fotos legacy tras `completed`,
  - despliegue previo de la Edge Function `booking-complete`.
- Queda recomendado como paso externo final ejecutar un smoke con una cuenta `gardener` real para marcar una reserva operativa como `completed` y confirmar borrado real de `booking_media` y objetos Storage en entorno compartido.

## Cobertura funcional compensatoria

- El navegador integrado no permite adjuntar ficheros locales de forma fiable para un E2E real con upload físico.
- Ese hueco se cubre con pruebas automatizadas de UI e integración ya ejecutadas sobre:
  - `src/components/shared/ZonePhotoGallery.test.tsx`
  - `src/pages/reserva/ConfirmationPage.test.tsx`
  - `src/pages/reserva/DetailsPage.test.tsx`
  - `src/pages/reserva/detailsPageAdapters.test.ts`
  - `src/utils/bookingPhotoPipeline.test.ts`
  - `src/utils/bookingPhotoContract.test.ts`
  - `src/utils/bookingTelemetry.test.ts`

## Conclusión

- El refactor queda validado con evidencia combinada de:
  - tests unitarios e integrados,
  - build de producción,
  - smoke manual sin sesión,
  - smoke manual con sesión real en el recorrido accesible desde el IDE.
- No quedan bloqueantes de implementación dentro del IDE; queda documentada la comprobación operativa externa recomendada para panel jardinero real.
