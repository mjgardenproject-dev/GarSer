# Banco de pruebas de la entrada manual

Herramienta de la ronda de rediseño de los formularios manuales
([`docs/audit/2026-09-29-formularios-manuales/`](../../../docs/audit/2026-09-29-formularios-manuales/README.md)).
Es el **Nivel B** de la puerta de prueba local de cada fase. No forma parte de la aplicación:
no entra en el `vite build` ni en el `tsc` del proyecto.

## Qué hace

Monta los componentes reales (`ManualEntryChoice`, `ManualEntryWizard`) dentro del mismo marco
que la página «Detalles» y los recorre con Playwright pulsando la interfaz:

1. **Maquetación** de los 7 servicios en 320, 360, 375, 414, 768 y 1280 px: desbordamiento
   horizontal, botón principal visible sin scroll (medido desde arriba de la pantalla),
   controles de menos de 44 px y errores de consola. Capturas a 375 px.
2. **Paridad de lo enviado**: introduce las 88 respuestas de referencia
   (`src/pages/reserva/manualEntryParityFixtures.ts`) y comprueba:
   - que lo que emite el asistente construye el mismo `patch` que la respuesta de referencia;
   - que el payload y los eventos de telemetría son idénticos a la línea base
     (`baseline/payloads.json`).
3. **Escenarios** de los hallazgos de la auditoría: stepper de altura del seto (S-SET-1), coma
   decimal (V2), elementos fantasma (S-ARB-1, S-PAL-1, S-FIT-1), tecla Intro y «Atrás» en la
   primera pantalla (V5).

## Uso

Desde la raíz del repositorio (tarda unos 4-5 minutos completo):

```bash
node scripts/qa/manual-entry/bench.mjs --out /tmp/garser-manual-entry-qa
```

| Opción | Efecto |
|---|---|
| `--out DIR` | Carpeta del informe (`REPORT.md`, `report.json`) y de las capturas. |
| `--widths 320,375` | Solo esos anchos. |
| `--services lawn,hedge` | Solo esos servicios. |
| `--skip-payloads` | Sin la paridad de lo enviado (rápido, solo maquetación y escenarios). |
| `--no-shots` | Sin capturas. |
| `--strict` | Termina con código 1 si algún criterio falla (para las fases posteriores). |
| `--write-baseline` | Regenera `baseline/payloads.json`. **Solo** en un paso del plan que prevea el cambio (hoy, 4.3-D1), revisando el diff. |
| `--port 5199` | Puerto del servidor del banco. |

Requisitos: Playwright (paquete `playwright` del proyecto o global) con su Chromium. El banco
no hace llamadas de red; si el entorno no tiene `VITE_SUPABASE_URL`, usa valores ficticios.

## Cuando una fase cambia la interfaz

La forma de conducir cada pantalla (textos de botones, `aria-label`, detección de pantalla)
vive en `detectScreen`, `planItemScreen` y `applyActions` de `bench.mjs`, y el marco de la
página en `main.tsx`. Se actualizan con la fase. **Nunca** se tocan las respuestas de
referencia ni la línea base para que un recorrido «pase».
