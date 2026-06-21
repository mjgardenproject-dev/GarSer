# GarSer — Informe de Auditoría de Producción (2026-06-21)

> Base auditada: rama `main` (idéntica a `feat/ai-pricing-refactor-phase1-3`; el commit
> extra de main es un redeploy vacío). Primera pasada: **auditoría estática**. La auditoría
> web en vivo (responsive/UX) está pendiente de ejecutar con `npm run dev` + navegador.

## Resumen ejecutivo

| Severidad | Nº hallazgos (1ª pasada estática + vivo público) |
|---|---|
| 🔴 Crítico | 2 |
| 🟠 Alto | 5 |
| 🟡 Medio | 5 |
| 🔵 Bajo | 2 |

**Veredicto preliminar:** NO listo para producción. Bloqueante principal: **no existe el
sistema de emails transaccionales** (confirmación de reserva al cliente y aviso de nueva
reserva al jardinero), algo esencial en un marketplace. Le sigue una fuerte deuda de
mantenibilidad (monolitos + 263 `as any`) y un placeholder de desarrollo visible al público.

### Top 5 bloqueantes
1. Emails transaccionales inexistentes (carpetas `send-email/` y `booking-confirmation-email/` vacías).
2. Placeholder de desarrollo visible en landings públicas (ver `02-live-findings.md` LIVE-1).
3. Feature visible sin terminar: `/admin/settings` = "Configuración en construcción".
4. Deuda de mantenibilidad crítica: `DetailsPage.tsx` 5.966 líneas, `ConfirmationPage.tsx` 2.149.
5. ~35 archivos de scripts/SQL/debug sueltos en la raíz del repo (código basura).

---

## 🔴 CRÍTICOS

### [CRÍTICO] No existe el sistema de emails transaccionales
- **Dimensión:** 6 — Funciones faltantes
- **Archivo:** `supabase/functions/send-email/` (0 archivos), `supabase/functions/booking-confirmation-email/` (0 archivos)
- **Problema:** Las dos carpetas de edge function de email están vacías (stubs nunca implementados). En todo el frontend solo hay **una** invocación de email (`send-email-notification` desde `ApplicationsAdmin.tsx:53`). No se envía confirmación de reserva al cliente, ni aviso de nueva reserva al jardinero, ni recordatorios, ni avisos de cambio de estado/cancelación.
- **Impacto:** Cliente reserva y no recibe nada; jardinero no se entera de nuevas reservas. Inviable para un marketplace en producción.
- **Fix:** Implementar `booking-confirmation-email` (cliente) y un aviso al jardinero, e invocarlos desde el flujo de reserva (tras `booking-complete`/pago confirmado). Definir proveedor (Resend/SendGrid) y plantillas. Eliminar o implementar `send-email/`.
- **Esfuerzo:** L

### [CRÍTICO] Deuda de mantenibilidad: monolitos gigantes
- **Dimensión:** 1/2 — Negocio / Basura
- **Archivo:** `src/pages/reserva/DetailsPage.tsx` (5.966 líneas), `src/pages/reserva/ConfirmationPage.tsx` (2.149)
- **Problema:** Un único componente de ~6k líneas concentra captura de fotos, llamadas a IA, normalización y render de los 7 servicios. Imposible de revisar, testear y mantener con seguridad; cualquier cambio arriesga regresiones en todos los servicios.
- **Impacto:** Alto riesgo de bugs al evolucionar; onboarding y revisión muy costosos.
- **Fix:** Extraer por servicio a `components/booking/details/*` (como ya se intentó) + hooks. Hacerlo con tests de caracterización primero para no romper comportamiento.
- **Esfuerzo:** L

---

## 🟠 ALTOS

### [ALTO] Placeholder de desarrollo visible en landings públicas (hallazgo en vivo)
- **Dimensión:** 7 — Features sin terminar (público)
- **Archivo:** `src/components/public/MarketingImageSlot.tsx:29`
- **Problema:** Cuando la imagen de marketing no existe en Storage, el fallback muestra al público "SLOT LISTO PARA FOTO REAL", instrucciones de desarrollo y la ruta interna del bucket. Visto en vivo en `/` (4 tarjetas) y `/para-jardineros`.
- **Fix:** Fallback neutro de marca en producción; detalle técnico solo en `DEV`. **Estado: corregido en PR `fix/audit-production-hygiene`.** Pendiente subir imágenes reales.
- **Esfuerzo:** S (hecho) + M (imágenes)

### [ALTO] Feature visible sin terminar: ajustes de admin
- **Dimensión:** 7 — Features sin terminar
- **Archivo:** `src/App.tsx:230`
- **Problema:** `/admin/settings` renderiza literalmente `"Configuración en construcción"`.
- **Fix:** Implementar la pantalla o retirar la entrada del menú hasta que exista.
- **Esfuerzo:** M

### [ALTO] ~35 archivos sueltos en la raíz del repositorio
- **Dimensión:** 2 — Basura
- **Archivo:** raíz: `check_*.js` (6), `debug-*.js` (2), `test-booking.js`, `investigate_duplicates.js`, `get-gardeners.js`, `apply_*.js` (2), `loadSupabaseAdminEnv.js`, `create_availability_blocks.js`, varios `fix_rls_*.sql`, `*.sql` de diagnóstico, `debug-*.md`, `test-gardener-booking.html`, `.dbg/` trackeado.
- **Problema:** Scripts ad-hoc de desarrollo y SQL de parcheo mezclados con el código de la app. Ruido, confusión y riesgo de ejecutar algo destructivo por error.
- **Nota:** `create_booking_photos_bucket.js`, `enforce_canonical_services.js` y `seed_services.js` SÍ están referenciados por scripts de `package.json` → mover a `scripts/`, no borrar.
- **Fix:** Mover los útiles vigentes a `scripts/`, eliminar el resto (verificando que no se referencian). Quitar `.dbg/` y `.tsbuildinfo` del control de versiones.
- **Esfuerzo:** M

### [ALTO] Type-safety erosionada: 263 usos de `as any`
- **Dimensión:** 1/5 — Negocio / Datos
- **Archivo:** múltiple (p.ej. `src/components/gardener/ProfileSettings.tsx:571` `(supabase... as any)`)
- **Problema:** 263 `as any` desactivan el chequeo de tipos justo donde más importa (escrituras a BD, payloads de pricing). Errores de forma de datos pasan desapercibidos hasta runtime.
- **Fix:** Tipar las respuestas de Supabase con `src/types/supabase.ts` y reducir `as any` progresivamente, priorizando escrituras a BD.
- **Esfuerzo:** L

### [ALTO] Escrituras a Supabase — revisar manejo de error (44 puntos)
- **Dimensión:** 5 — Datos
- **Archivo:** 44 `.insert/.update/.upsert` en `src/` (p.ej. `GardenerDashboard.tsx:216`, `RecurringScheduleManager.tsx:208/264`, `ProfileSettings.tsx:364`)
- **Problema:** Hay que verificar que cada escritura comprueba `error` y da feedback al usuario; un fallo silencioso pierde datos sin avisar.
- **Fix:** Auditar las 44 una a una; estandarizar patrón de manejo de error + toast. (Pendiente de revisión fina en 2ª pasada.)
- **Esfuerzo:** M

---

## 🟡 MEDIOS

### [MEDIO] 88 `console.log` en `src/`
- **Dimensión:** 2 — Basura
- **Fix:** Eliminar o sustituir por un logger gateado en `DEV`. **Esfuerzo:** S

### [MEDIO] 44 marcadores TODO/FIXME en `src/`
- **Dimensión:** 7 — Features
- **Fix:** Triagear: convertir en issues los reales, borrar los obsoletos. **Esfuerzo:** M

### [MEDIO] `send-email-notification` solo se usa en un punto
- **Dimensión:** 6 — Funciones faltantes
- **Archivo:** `src/components/admin/ApplicationsAdmin.tsx:53`
- **Problema:** La única notificación por email es para aplicaciones de jardinero en admin. El resto del ciclo de vida (reserva, pago, cancelación) no notifica. **Esfuerzo:** M

### [MEDIO] Componentes de debug en el bundle de producción
- **Dimensión:** 2 — Basura
- **Archivo:** `src/App.tsx:23,25,26` (imports de `GoogleMapsDebug`, `RoleDebug`, `RoleMonitor`)
- **Corrección de severidad:** Las rutas `/debug-maps` y `/debug-roles` **SÍ están gateadas** por `DevelopmentRoute` (exige `import.meta.env.DEV` + localhost, o `VITE_ENABLE_DEBUG_ROUTES=true`), y `/role-monitor` es admin-only. **No están expuestas en producción** (hallazgo inicial corregido). El único coste real es que esos componentes se importan a nivel de módulo y entran en el bundle de producción.
- **Fix:** `lazy()` para los componentes de debug, o excluirlos del build de producción. **Esfuerzo:** S

### [MEDIO] Archivos de debug trackeados en git (`.dbg/`)
- **Dimensión:** 2/3 — Basura / Seguridad
- **Archivo:** `.dbg/stripe-touch-offset.env`, `.dbg/gemini_probe*.json`, `.ndjson`
- **Problema:** Aunque el `.env` de `.dbg` solo contiene `DEBUG_SERVER_URL`/`DEBUG_SESSION_ID` (no secretos), no debería versionarse. **Fix:** añadir `.dbg/` a `.gitignore` y `git rm --cached`. **Esfuerzo:** S

### [MEDIO] Tooling de tests presente pero cobertura por verificar
- **Dimensión:** 5 — Datos/calidad
- **Archivo:** 58 archivos `*.test.*`
- **Problema:** Hay Vitest y 58 tests; falta confirmar que pasan en verde y qué cubren (especialmente pricing y flujo de reserva). **Fix:** `npx vitest run` y medir cobertura de las áreas críticas. **Esfuerzo:** S

---

## 🔵 BAJOS

### [BAJO] `.tsbuildinfo` versionado
- **Archivo:** `tsconfig.app.tsbuildinfo`, `tsconfig.node.tsbuildinfo` — añadir a `.gitignore`. **Esfuerzo:** S

### [BAJO] Documentos de debug en la raíz
- **Archivo:** `debug-*.md`, `DOGFOODING_REPORT.md`, `dogfood-output/` — mover a `docs/` o eliminar. **Esfuerzo:** S

---

## Pendiente: 2ª pasada (web en vivo)
Aún sin ejecutar (requiere `npm run dev` + navegador). Cubrirá las dimensiones 8-10
(responsive/mobile-first, distribución del espacio, UX/alineación) y validará en vivo las
features rotas. Ver `references/live-web-audit-playbook.md`.

---

## Checklist de production-readiness
- [ ] Emails transaccionales (confirmación reserva, aviso jardinero) implementados y probados
- [ ] RLS verificada en todas las tablas con datos de usuario *(pendiente /security-review)*
- [x] Webhook de Stripe verifica firma (`booking-payment-webhook` usa `constructEvent` + `STRIPE_WEBHOOK_SECRET`)
- [ ] Rutas/código de debug eliminados del bundle de producción
- [ ] Sin console.log en producción (88 actuales)
- [ ] Flujo de reserva completo sin pérdida de datos *(pendiente 2ª pasada)*
- [ ] Todas las pantallas usables a 375px sin scroll horizontal *(pendiente 2ª pasada)*
- [ ] Estados de carga/error/vacío en todas las vistas con datos remotos *(pendiente)*
- [ ] Features visibles terminadas (sin "en construcción")
- [ ] Manejo de error en todas las escrituras a Supabase (44 a revisar)
- [ ] Lint y tests en verde *(por ejecutar)*

---

## Plan de PRs (propuesto)
| PR | Dimensión | Cubre | Riesgo regresión | Estado |
|---|---|---|---|---|
| 1 | 2 Basura | Mover scripts a `scripts/`, borrar basura, `.gitignore` `.dbg/`+`.tsbuildinfo` | Bajo | Propuesto |
| 2 | 2/4 Debug | Eliminar rutas/componente debug de producción | Bajo | Propuesto |
| 3 | 2 Basura | Quitar/loguear los 88 `console.log` | Bajo | Propuesto |
| 4 | 6 Emails | Implementar emails transaccionales + cableado | Medio | Propuesto |
| 5 | 7 Features | Resolver `/admin/settings` | Bajo | Propuesto |
| 6 | 5 Datos | Endurecer manejo de error en escrituras Supabase | Medio | Propuesto |
| 7 | 1/2 Deuda | Plan de extracción de DetailsPage (con tests) | Alto | Propuesto |
