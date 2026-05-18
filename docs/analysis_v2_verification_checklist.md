# Checklist de verificación `analysis_v2`

Estado verificado en este entorno local mediante tests automatizados de Vitest.

## Evidencia ejecutada

- Comando ejecutado:
  - `npx vitest run src/shared/analysisV2.test.ts src/shared/analysisV2Details.test.ts src/components/shared/ServiceResultCard.test.tsx src/components/shared/ZoneActionButton.test.tsx`
- Resultado observado:
  - `4` archivos de test en verde.
  - `26` tests pasando.

## Checklist cerrada con evidencia real

- [x] Helpers de adaptación legacy -> `analysis_v2` verificados para todos los servicios soportados.
- [x] Semántica transversal de `nivel2` verificada en todos los servicios soportados.
- [x] Semántica transversal de `nivel3` verificada en todos los servicios soportados.
- [x] Error técnico controlado verificado con `error_code`, `error_message_safe` y observaciones canónicas.
- [x] Presentación helper para `nivel1`, `nivel2`, `nivel3` y `technical_error` verificada.
- [x] Resolución canónica de observaciones cliente verificada.
- [x] Resolución canónica y deduplicación de índices analizados verificada.
- [x] Reset de campos comunes para reanálisis verificado a nivel helper.
- [x] Mensajes de carga por servicio del patrón común verificados.
- [x] UI compartida `ServiceResultCard` verificada para estados `nivel1`, `nivel2`, `nivel3` y `technical_error`.
- [x] UI compartida `ZoneActionButton` verificada para análisis inicial, reanálisis y estado cargando.

## Warnings y limitaciones reales

- [ ] No está verificado extremo a extremo el flujo completo de reanálisis dentro de `DetailsPage.tsx`.
  - Motivo: depende de estado complejo de página, selección de fotos, confirmaciones UI y llamadas asíncronas a análisis; no existe aquí un harness E2E/integración montado para demostrarlo sin introducir mocks extensivos o validación artificial.
- [ ] No está verificada la invocación real del proveedor de análisis ni de Supabase Edge Functions.
  - Motivo: los tests ejecutados son unitarios/UI local; no levantan servicios externos ni credenciales reales.
- [ ] No está verificada la persistencia completa posterior al reanálisis en contexto/reserva.
  - Motivo: requeriría integración real entre `DetailsPage.tsx`, `BookingContext.tsx`, red y backend.
- [ ] No está verificada la apariencia visual final (colores, layout responsive, animaciones) más allá del contenido textual renderizado.
  - Motivo: en este entorno se validó comportamiento funcional por DOM/test, no inspección visual o dogfooding interactivo.

## Archivos con evidencia automatizada

- `src/shared/analysisV2.test.ts`
- `src/shared/analysisV2Details.test.ts`
- `src/components/shared/ServiceResultCard.test.tsx`
- `src/components/shared/ZoneActionButton.test.tsx`
