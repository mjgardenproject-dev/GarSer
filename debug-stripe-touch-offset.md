# Debug Session: stripe-touch-offset
- **Status**: [OPEN]
- **Issue**: En móvil, el toque/click dentro de Stripe Elements queda desplazado respecto al punto visual del formulario en checkout.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-stripe-touch-offset.ndjson

## Reproduction Steps
1. Abrir `http://localhost:5173/`.
2. Completar el flujo de reserva hasta checkout con usuario autenticado.
3. Abrir el sheet de pago.
4. Intentar interactuar con campos/opciones de Stripe Elements en móvil.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Un `transform`/`scale` en el sheet o ancestros rompe el hit testing del iframe de Stripe | High | Low | Pending |
| B | Una capa superpuesta intercepta toques parcialmente | High | Med | Pending |
| C | El offset viene de `safe-area`/viewport/keyboard y no del iframe | Med | Med | Pending |
| D | Stripe se monta durante transición y calcula mal su geometría inicial | Med | Med | Pending |
| E | El fallo depende del navegador/dispositivo y dejará señales en consola/network/layout | Low | Med | Pending |

## Log Evidence
- Pending

## Verification Conclusion
- Pending
