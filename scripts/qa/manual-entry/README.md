# Banco de pruebas de la entrada manual

Herramienta de la ronda de rediseño de los formularios manuales
([`docs/audit/2026-09-30-formularios-manuales-ux/`](../../../docs/audit/2026-09-30-formularios-manuales-ux/README.md); creado en la ronda del 2026-09-29, que se retiró).
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
| `--write-baseline` | Regenera `baseline/payloads.json`. **Solo** en un paso del plan que prevea el cambio (ninguno en la ronda actual), revisando el diff. |
| `--port 5199` | Puerto del servidor del banco. |

Requisitos: Playwright (paquete `playwright` del proyecto o global) con su Chromium. El banco
no hace llamadas de red; si el entorno no tiene `VITE_SUPABASE_URL`, usa valores ficticios.

## Cuando una fase cambia la interfaz

La forma de conducir cada pantalla (textos de botones, `aria-label`, detección de pantalla)
vive en `detectScreen`, `planItemScreen` y `applyActions` de `bench.mjs`, y el marco de la
página en `main.tsx`. Se actualizan con la fase. **Nunca** se tocan las respuestas de
referencia ni la línea base para que un recorrido «pase».

## App real en local: `e2e-local.mjs` (Nivel C y D)

Recorre la reserva REAL (dirección → servicio → «Detalles» manual → «Profesionales») contra el
Supabase local, en `main` (5192) y en la rama (5191), con las mismas respuestas por servicio,
y compara: total y horas por profesional, huella de lo guardado, telemetría
(`booking_funnel_events`), declaraciones (`--login`) y el precio de la corrección del
jardinero (`recalculate_correction`, Nivel D).

```bash
npm_config_prefix=~/Downloads/auditorias/qa-tools PLAYWRIGHT_BROWSERS_PATH=~/Downloads/auditorias/qa-tools/browsers \
  node scripts/qa/manual-entry/e2e-local.mjs --out ~/Downloads/auditorias/formularios-qa/fase-N-e2e --widths 375,1280
```

| Opción | Efecto |
|---|---|
| `--targets main=URL,rama=URL` | Servidores a comparar (solo localhost). Por defecto 5192 y 5191. |
| `--services lawn,hedge` | Solo esos servicios. |
| `--widths 375,1280` | Anchos (por defecto 375). |
| `--login` | Con el cliente de `supabase/seed.sql` (credenciales leídas de ese archivo en tiempo de ejecución). Añade la comparación de `booking_manual_declarations`. |
| `--correction-from DIR` | Solo recalcula el Nivel D sobre una ejecución anterior. |
| `--no-shots` | Sin capturas. |

Requisitos del entorno local: tras cada `supabase db reset`, dar licencia vigente al jardinero
sembrado (la siembra no fija `license_expires_at` y la puerta de licencia deja fitosanitarios y
desbroce con herbicida sin profesionales):

```bash
docker exec supabase_db_GarSer-main_4 psql -U postgres -c "update gardener_profiles set license_expires_at = now() + interval '1 year', license_verified_at = now() where user_id = '11111111-aaaa-4aaa-8aaa-111111111111'"
```

Las respuestas (`SPECS`) no se cambian entre fases; cuando una fase cambie la interfaz, se
adaptan los conductores (`drive*`, `ACTION_BUTTONS`).

## Modal de corrección del jardinero: `gardener-local.mjs` (Nivel D, interfaz)

Abre el modal real del panel del jardinero a 375 px, recalcula con 80 m², «Descuidado» y retirada,
y comprueba que propone **45 €** (línea base), sin pie fijo dentro del modal y sin errores de
consola. Necesita una solicitud manual `pending` de césped (la consulta para crearla está en la
cabecera del script).

```bash
npm_config_prefix=~/Downloads/auditorias/qa-tools PLAYWRIGHT_BROWSERS_PATH=~/Downloads/auditorias/qa-tools/browsers \
  node scripts/qa/manual-entry/gardener-local.mjs http://localhost:5191 ~/Downloads/auditorias/formularios-qa/fase-N-jardinero
```

## Escenarios de F4 en la app real: `scenarios-local.mjs`

Repite en la app real dos fallos corregidos en F4: el elemento fantasma de árboles (debe quedar
un solo árbol guardado y el total de un árbol) y la retirada heredada tras fitosanitarios (el
desbroce debe arrancar en «Sí»). Termina con código 1 si alguno vuelve.

```bash
npm_config_prefix=~/Downloads/auditorias/qa-tools PLAYWRIGHT_BROWSERS_PATH=~/Downloads/auditorias/qa-tools/browsers \
  node scripts/qa/manual-entry/scenarios-local.mjs http://localhost:5191 ~/Downloads/auditorias/formularios-qa/fase-N-escenarios
```
