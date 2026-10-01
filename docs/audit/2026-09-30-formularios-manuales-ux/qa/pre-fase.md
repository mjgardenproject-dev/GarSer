# Pre-fase — entorno limpio, duplicado de producción y línea base

Fecha: 2026-09-30 · Rama: `feat/formularios-manuales-ux-v2` · Autorizada por el usuario
(«adelante con la pre fase»).

## PRE-1 · Coordinación

- Los servidores de desarrollo que otras sesiones habían dejado en 5173 y 5190 ya no estaban
  en marcha al empezar. Ningún proceso ajeno en 5170-5199.
- Sesiones pares con temas parecidos (inactivas): «Diseño formularios reservas manual» y
  «Auditoría UX/UI formularios GarSer.es» (nube). Archivarlas queda a decisión del usuario.

## PRE-2 · Producción = `origin/main`

| Pieza | Producción | Repo | Estado |
|---|---|---|---|
| Frontend (Vercel, despliegue GitHub «Production») | `81397be`, estado `success`, 2026-09-29 21:41 UTC | `origin/main` = `81397be` | ✅ igual |
| Migraciones (`supabase migration list --linked`) | 139 aplicadas | 139 archivos | ✅ igual, una a una |
| `booking-authority` | v47, desplegada 2026-09-29 13:46 | `index.ts` idéntico (descargado y comparado); su grafo de precio (`bookingQuoteCore`, `bookingEligibilityCore`, `manualEntryValidation`, `domain/*`, `bookingAmounts`, `hourlyPricing`) sin cambios desde #40 (28-09) | ✅ equivalente |
| `booking-manual-declaration` | v12, desplegada **2026-08-24** | `index.ts` idéntico, pero la validación que empaqueta cambió el 11-09 y el 12-09 | ⚠️ desfase → **H-N-10** (producción valida menos; no bloquea esta ronda) |

La CLI no permite descargar los archivos compartidos de una función (rechaza rutas fuera de
`supabase/functions`), así que la equivalencia se ha comprobado por el `index.ts` y por el
historial de su grafo de imports.

## PRE-3 · Duplicado de referencia

- Worktree `~/Downloads/auditorias/formularios-main` en `origin/main` (`81397be`, desacoplado),
  con `.env.local` copiado. **Nunca se edita.**
- `node_modules`: **carpeta propia con un enlace por paquete** al `node_modules` del checkout
  principal, **sin** `.vite`, `.vite-temp` ni `.cache` (corregido en F2, H-N-13). Al principio se
  enlazó la carpeta entera, y los dos servidores compartían la caché de Vite y se la invalidaban
  mutuamente (504 «Outdated Optimize Dep», panel caído al azar).
- `.claude/launch.json` (marcado `skip-worktree`): `formularios-main` → 5192,
  `formularios-rama` → 5191.

## PRE-4 · Supabase local

- Faltaban **18** migraciones (24-09 → 29-09) y estaban aplicadas fuera de orden;
  `supabase migration up --include-all` fallaba en `my_jobs` (tipo de retorno cambiado por una
  migración posterior ya aplicada).
- Copia completa previa: `~/Downloads/garser-backups/local-db-2026-09-30-pre-reset.sql.gz`
  (21 MB; 8 usuarios, 9 reservas, 3 jardineros). Restaurable con
  `gunzip -c … | docker exec -i supabase_db_GarSer-main_4 psql -U postgres`.
- `supabase db reset --local`: **139/139** migraciones en orden + `seed.sql`.
- `service_role` con permisos en las 50 tablas de `public`.
- `docker restart supabase_edge_runtime_GarSer-main_4`: las Edge Functions sirven el código de
  esta rama (= `origin/main` en todo lo que importan).

## PRE-5 · Datos

- Siembra: jardinero `Miguel Ángel Ruiz`, cliente y administrador; los 7 servicios con tarifa.
- **Licencia fitosanitaria:** la siembra no fija `license_expires_at` y la puerta de licencia
  dejaba fitosanitarios (convencional) y desbroce (con herbicida) sin profesionales (H-N-12).
  Arreglado **solo en la BD local** con el `update` documentado en `scripts/qa/manual-entry/README.md`.
  Hay que repetirlo tras cada `db reset`.

## PRE-6 · Claves y banderas (solo nombres; ningún valor se ha leído en voz alta)

| Variable | Estado |
|---|---|
| `VITE_SUPABASE_URL` | local (`127.0.0.1:54321`) |
| `VITE_ENABLE_MANUAL_BOOKING_INPUT` | `true` |
| `VITE_GOOGLE_MAPS_API_KEY` | presente; el autocompletado funciona |
| `VITE_STRIPE_PUBLISHABLE_KEY` | `pk_test_…` |
| `supabase/functions/.env` `STRIPE_SECRET_KEY` | `sk_test_…` |

El pago con tarjeta de prueba **no** se ha usado. Se pedirá autorización cuando haga falta (F4/F12).

## PRE-7 · Herramientas

- Playwright no estaba instalado (H-N-11): instalado aislado en `~/Downloads/auditorias/qa-tools`
  (v1.63.0 + Chromium headless).
- Panel del navegador: localhost 5191/5192 operativos.
- MCP de Supabase: sigue sin conectar (H-N-07); se usa la CLI.

## PRE-8 · Línea base

Ver [`linea-base.md`](linea-base.md).

## Resultado

**Pre-fase en verde.** Entorno local = producción en código, esquema y funciones de precio;
línea base medida en los cuatro niveles automáticos (A, B, C, D-precio).
