# Debug Session: gemini-analysis-error
- **Status**: [OPEN]
- **Issue**: La web muestra error tecnico al completar un analisis visual; hay que comprobar si Gemini responde correctamente y localizar el fallo exacto en el flujo.
- **Debug Server**: Pending
- **Log File**: .dbg/trae-debug-log-gemini-analysis-error.ndjson

## Reproduction Steps
1. Abrir `http://localhost:5173/reservar`.
2. Ir a una zona con foto(s) y lanzar un analisis.
3. Observar que la UI muestra "No se ha podido completar el analisis" y "La llamada al proveedor de analisis ha fallado".

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Gemini devuelve un error de autenticacion, cuota o red y la edge function lo traduce a fallo tecnico | High | Low | Pending |
| B | Gemini responde con JSON invalido o con una forma no compatible con el servicio analizado | High | Medium | Pending |
| C | La edge function responde correctamente pero el frontend interpreta `reasons` o `analysis_v2` como fallo visual | High | Medium | Pending |
| D | El problema esta en la descarga/conversion de imagenes a base64 dentro de la edge function y Gemini nunca recibe imagen util | Medium | Medium | Pending |
| E | Hay una desalineacion entre el servicio enviado por frontend y las ramas de normalizacion del backend, provocando un falso error | Medium | Medium | Pending |

## Log Evidence
- `.dbg/gemini_probe_lawn.json`: `http_status=200`, `reasons=["PROVIDER_REQUEST_FAILED"]`, `analysis_v2.analysis_status="technical_error"`, `error_code="PROVIDER_REQUEST_FAILED"` para `service_name="Corte de césped"` con foto remota.
- `.dbg/gemini_probe_lawn_text_only.json`: mismo resultado (`PROVIDER_REQUEST_FAILED`) incluso sin fotos. Esto descarta que el origen principal sea la conversion/base64 o la descarga de imagenes.
- `.dbg/gemini_probe_auto_quote.json`: `reasons=["PROVIDER_REQUEST_FAILED"]` en `mode="auto_quote"`, confirmando que no falla solo la rama de cesped sino cualquier llamada Gemini en esta edge function.
- `.dbg/gemini_probe_control.json`: `http_status=200` y calculo correcto en `mode="calculate_palm_pricing"`, confirmando que la edge function y Supabase responden bien cuando no interviene Gemini.

## Verification Conclusion
- Hipotesis A: **Confirmada parcialmente**. El problema esta en la llamada al proveedor/modelo, no en la UI.
- Hipotesis B: **Rechazada** como causa principal. No hay evidencia de parser/shape invalido; la function ya llega degradada con `PROVIDER_REQUEST_FAILED`.
- Hipotesis C: **Rechazada**. El frontend refleja fielmente `analysis_v2.error_code`.
- Hipotesis D: **Rechazada** como causa principal. El error aparece tambien sin imagenes.
- Hipotesis E: **Rechazada**. El fallo se reproduce tambien en `auto_quote`, fuera del flujo concreto de zona.

- Conclusion operativa: la implementacion actual de `callGemini()` colapsa cualquier respuesta no-OK o error de red de Google en el motivo generico `PROVIDER_REQUEST_FAILED`, por lo que el backend esta ocultando la causa exacta aguas arriba (p. ej. API key invalida/expirada, modelo no habilitado, 4xx/5xx del endpoint o bloqueo de red).
