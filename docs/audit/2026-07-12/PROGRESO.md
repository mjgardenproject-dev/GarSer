# Estado de la auditoría de producción — checkpoint

Última actualización: 2026-07-13. Carpeta de trabajo: `docs/audit/2026-07-12/`.

## 🔧 IMPLEMENTACIÓN (rama fix/pre-produccion)
- **Paso 0** ✅ rama creada, baseline verde (356 tests, build ok, 3 errores lint preexistentes).
- **Paso 1** ✅ (local, pendiente de aprobación del usuario) — cierre de fuga PII:
  - Migración `20260713000000_secure_pii_access.sql`: vista `public_gardener_directory` (vitrina sin phone/address), REVOKE SELECT anon en profiles/gardener_profiles, DROP policies USING(true), policies de contraparte (bookings + booking_requests/responses).
  - Repunteados a la vista: ProvidersPage.tsx:397, GardenerPublicProfile.tsx:23, ConfirmationPage.tsx:826.
  - Tipos regenerados (`supabase gen types --local`) → incluye la vista + las 4 tablas que faltaban.
  - Test ProvidersPage mock actualizado. Verificado: curl anon a profiles/gardener_profiles → permission denied; vista → OK sin phone/address; 356 tests verdes; build ok; app arranca sin errores.
  - **Pendiente producción (fase final):** aplicar esta migración a la BD real (ya registrada en el sistema de migraciones tras `db reset`).
  - **Nota entorno local:** el Storage local (storage-api v1.58.17) tiene el esquema desincronizado (falta columna `level`); ni `db reset` ni actualizar el CLI (2.98.2→2.109.1) lo resolvieron. Es desajuste de tooling del stack de desarrollo, NO afecta a código ni a producción. Consecuencia: las subidas a Storage fallan SOLO en local. Los dos `db reset` borraron los datos de prueba locales. Hallazgo real de producción aparte: HEIC rechazado en onboarding (registrado en 01-static-findings, ALTO).

- **Paso 2** ✅ (local, pendiente aprobación) — blindaje de escritura directa de `bookings`:
  - Migración `20260713000001_harden_bookings_writes.sql`: REVOKE INSERT (solo RPC SECURITY DEFINER crean reservas), UPDATE restringido a la columna `status` (column-level grant) → `total_price` y demás campos congelados para escritura directa; drop de policies laxas.
  - **Corrección de defecto del paso 1:** las policies de contraparte de profiles/gardener_profiles causaban RECURSIÓN INFINITA (profiles→bookings→profiles). Corregido con función `shares_booking_with(uuid)` SECURITY DEFINER que rompe el ciclo. Migración del paso 1 (20260713000000) editada en la fuente para usarla.
  - Verificado por API REST con JWT de usuario: status='confirmed' → 200 ✓; total_price=1 → 403 ✓; INSERT con precio inventado → 403 ✓; precio real sin cambiar (60€) ✓; lectura autenticada de profiles sin recursión ✓; fuga anónima sigue cerrada ✓. Build ✓. Tests de lógica 51/51 ✓.
  - **Pendiente producción (fase final):** aplicar migraciones 20260713000000 (corregida) y 20260713000001.

- **Paso 3** 🟡 (en curso, 2 de 3 sub-partes hechas):
  - ✅ **Guard palmeras (CRÍTICO):** bookingQuoteCore.ts — `hasTreeOrPalm` ahora detecta por payload (palmGroups/treeGroups) en vez de substrings de UUIDs. Palmeras per_hour vuelven a usar el motor detallado (extras). Test de regresión añadido (palmeras per_hour = 50€ engine, no 30€ ingenuo). 357 tests verdes.
  - ✅ **Herbicida en fito (ALTO):** decisión del usuario = quitarlo de fito (lo cubre Desbroce). Eliminado el grupo 'Control de Malas Hierbas' de PHYTOSANITARY_GROUPED_FIELDS (DetailsPage), la rama 'herbi'→'herbicida' del mapeo (DetailsPage:2330) y los campos herbicida_*_densidad_m2 del prompt (new_prompts.ts). Referencias de tipo/manejo defensivo quedan inertes (código muerto menor → paso 11). **Pendiente producción:** redesplegar ai-pricing-estimator (prompt).
  - ⏳ **Fito manual vs IA (ALTO):** PENDIENTE. Es un refactor profundo del motor de fito (dos modelos de precio distintos: rama sin métricas suma tarifa fija por tratamiento con insecticida→curativo y palmeras/árboles>3m→banda mediana; rama con métricas usa tarifa única preventivo/curativo + combo). Matiz de producto: el wizard manual no pregunta la banda de altura exacta. Merece la skill garser-manual-entry como SSOT + tests de paridad exhaustivos. NO abordado para no introducir bugs de precio peores.
  - **Pendiente producción (fase final):** redesplegar booking-authority + booking-payment (tocan bookingQuoteCore) y ai-pricing-estimator (prompt).

### ✅ Regresión de entorno de test RESUELTA
`brew upgrade supabase` arrastró Node a v26.5.0, incompatible con jsdom 29 → 24 tests de UI fallaban. **Resuelto:** `brew install node@22` + `brew link --overwrite --force node@22` → Node 22.23.1 LTS activo. Suite completa **356/356 en verde**, build ✓. Añadido `.nvmrc` con `22`.

## ✅ AUDITORÍA COMPLETA
Las 7 dimensiones estáticas entregadas + web viva + informe maestro `REPORT.md` con veredicto **NO-GO** (5 bloqueantes acotados). Nada de código modificado. Entregables: `00-app-map.md`, `01-static-findings.md`, `02-live-findings.md`, `REPORT.md`.


## Hecho ✅
- **Paso 0** — Playbooks leídos, alcance fijado (todas las dimensiones, web viva local, SIN aplicar fixes; entregable = informe).
- **Paso 1** — Mapa de la app completo → `00-app-map.md` (rutas, edge functions, tablas/RLS/storage, toolchain).
- **Verificaciones del orquestador** (ya en 00-app-map.md):
  - Build ✅, tests 356/356 ✅, lint 3 errores triviales + 816 warnings.
  - **CRÍTICO verificado:** tabla `profiles` (full_name, phone, address) legible por `anon` — política `USING(true)` + GRANT en 20250929000001_anonymous_booking_access.sql:89-117, nunca revocada.
  - **CRÍTICO verificado:** `booking-payment-webhook` desplegado v10 (25-may) es anterior a la integración de emails (21-jun) y a fixes posteriores → los emails de confirmación de pago NO se disparan en producción. `booking-telemetry` también obsoleto (desplegado 20-may < commit 30-may). `booking-payment`/`booking-complete`/emails: ambiguos por horas (patrón deploy-antes-de-commit) → redesplegar TODO con `--use-api`.
  - Función fantasma `email-otp` desplegada (dic-2025) que no existe en el repo.
- **Paso 2 parcial** — Dimensiones completadas: **Dim 2 (basura)** y **Dim 6 (emails)** → hallazgos en `01-static-findings.md`.

## En curso ⏳
- **Dim 1 (negocio/paridad precios), Dim 3 (seguridad), Dim 4 (flujos), Dim 5 (datos/pagos), Dim 7 (features)**: subagentes reanudados tras límite de sesión (2ª vez). Si vuelven a caer, reanudarlos con SendMessage (conservan contexto).
- **Paso 3 (web en vivo)**: servidor dev arrancado (garser-dev, puerto 5173, preview). Home móvil auditada: OK visual, sin errores consola, sin overflow horizontal; copy sin tildes ("jardineria", "jardin"). Falta: resto de home, funnel completo 7 servicios (IA + manual), auth, jardinero, admin, área cliente, viewports 768/1440.

## Pendiente ⬜
- Consolidar Paso 4: `REPORT.md` (inventario maestro por severidad + go/no-go + checklist de lanzamiento).
- Pendientes manuales del usuario a incluir en go/no-go: plantillas Auth email (pendiente), imágenes services (vienen de BD `services.image_url` + tabla `service_images`; public/ solo tiene favicon — verificar en vivo), restricciones API key Maps (no verificable desde repo), E2E Stripe real (pendiente), verificación `supabase secrets list` (SMTP_USER/SMTP_PASS — modo MOCK devuelve success sin enviar).
- NO se aplica ningún fix en esta sesión (decisión del usuario).
