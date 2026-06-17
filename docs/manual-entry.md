# Entrada manual de variables (alternativa a fotos)

Permite al cliente calcular su presupuesto **introduciendo las variables a mano**, como alternativa
al análisis por fotos con IA, dentro de la misma página de detalles de la reserva.

El dato manual viaja por **el mismo motor de cálculo** que el flujo de fotos
(`buildAuthoritativeBookingQuote`), así que el origen (IA o manual) es indistinguible para el pricing.

> **Servicios "manual-only".** Algunos servicios nunca usaron análisis por fotos (hoy: *Desbroce de
> malas hierbas*). Para ellos **no se muestra el selector foto/manual**: se usa directamente su formulario
> manual existente. Se controla con `MANUAL_ONLY_SERVICE_KEYS` / `isManualOnlyService()` en
> `manualEntrySchema.ts`, que `DetailsPage` usa para calcular `manualChoiceAvailable`.

---

## Activar / desactivar (feature flag)

Variable de entorno de build (Vite):

```
VITE_ENABLE_MANUAL_BOOKING_INPUT=true
```

- `false` (por defecto): la página de detalles muestra **solo** el flujo de fotos actual. Nada cambia.
- `true`: arriba de la sección de fotos aparece el selector "Analizar con fotos" / "Introducir datos
  manualmente".

**Rollback:** poner el flag en `false`. La migración y la validación de servidor son aditivas e inertes
sin datos manuales; no hace falta revertir el esquema.

Helper: `isManualBookingInputEnabled()` en
[`src/utils/manualEntryFeatureFlag.ts`](../src/utils/manualEntryFeatureFlag.ts).

---

## Arquitectura (qué hace cada pieza)

### Núcleo isomórfico — `src/shared/manualEntry/`
- **`manualEntrySchema.ts`** — fuente única de verdad: una encuesta por servicio (pasos, campos,
  rangos/enums, microcopy, tipo de control). Sin dependencias de React/Supabase → se importa también
  desde la edge function en Deno.
- **`manualEntryValidation.ts`** — validación de rangos/enums/enteros y saneo. La usan el wizard
  (UX inmediata) y el servidor (`validateManualSerializableInput`, autoridad).
- **`legalCopy.ts`** — texto de consentimiento versionado (`MANUAL_ENTRY_LEGAL_VERSION`) + hash
  (`hashConsentText`) para auditar exactamente qué aceptó el cliente. ⚠️ El texto es una propuesta de
  producto: **revisar con criterio legal antes de publicar**. Cambiar el texto obliga a subir la versión.
- **`strings.ts`** — copys de UI en es-ES centralizados (listos para un futuro i18n).

### Builders — `src/pages/reserva/manualEntryBuilders.ts`
`buildManualBookingPatch({ serviceKey, items, wasteRemoval })` convierte las respuestas en las **mismas
colecciones** (`lawnZones`, `palmGroups`, …) que produce la IA, pasando por los mismos adapters. Marca
procedencia: `inputSource: 'manual'`, `dataInputMode: 'manual'`.

### Wizard — `src/components/booking/manual/`
`ManualEntryChoice` (selector), `ManualEntryWizard` (stepper genérico dirigido por el esquema, con
resumen editable + consentimiento), `ManualEntrySummary`, `ManualEntryConsent`,
`fields/ManualFieldRenderer` (stepper/slider/cards/toggle, táctil ≥44px, accesible). Integrado en
[`DetailsPage.tsx`](../src/pages/reserva/DetailsPage.tsx); en modo manual sustituye al uploader y aporta
su propio CTA. El borrador se conserva al alternar fotos↔manual y se persiste en `servicesData`.

### Servidor / datos
- **`booking-authority`** (edge): valida los rangos del input manual **antes** de cotizar
  (rechazo 422, sin truncar) y expone la acción `recalculate_correction`.
- **`booking-manual-declaration`** (edge): registra el consentimiento auditable (cliente, fecha,
  versión/hash del texto, variables declaradas).
- Migración [`20260616180000`](../supabase/migrations/20260616180000_manual_entry_declarations_and_revisions.sql):
  tablas `booking_manual_declarations` y `booking_variable_revisions`, columnas
  `bookings.data_input_mode` / `manual_declaration_id`.
- Migración [`20260616190000`](../supabase/migrations/20260616190000_link_manual_provenance_to_bookings.sql):
  triggers que, al crear la reserva, copian la procedencia desde el snapshot del quote y vinculan la
  declaración al booking. **Auditabilidad durable:** el consentimiento también viaja dentro del
  `input_payload` del quote firmado (`manualConsent`), independiente de si el usuario estaba autenticado.

---

## Ajuste de precio por discrepancia (antifraude)

1. Las reservas manuales muestran en el panel del jardinero el badge
   **"Datos introducidos manualmente por el cliente · no verificados por IA"**.
2. El jardinero pulsa **"Recalcular con las medidas reales del jardín"** → reabre la encuesta, introduce
   las medidas reales y el servidor **recalcula con el mismo motor** (`recalculate_correction`).
3. El total recalculado se vuelca en el campo de propuesta; el jardinero añade un motivo y **propone** el
   nuevo precio (RPC `propose_booking_price_change` existente).
4. **Cualquier cambio requiere aceptación explícita del cliente** (`respond_booking_price_change`). Si lo
   rechaza, puede cancelar sin penalización.
5. Cada propuesta sobre una reserva manual deja traza en `booking_variable_revisions` (variables
   originales del cliente vs corregidas por el jardinero, precios y autor) para análisis de discrepancias.

**Mejora futura (no implementada):** `client_discrepancy_score` derivado de `booking_variable_revisions`
para restringir la vía manual a clientes con discrepancias significativas repetidas.

---

## Telemetría

Eventos en [`bookingTelemetryCatalog.ts`](../src/shared/bookingTelemetryCatalog.ts):
`manual_entry_started`, `manual_entry_step_completed`, `manual_entry_consent_accepted`,
`manual_entry_submitted`, `manual_entry_submit_failed`, `manual_validation_rejected`,
`manual_input_mode_changed`, `price_discrepancy_proposed`, `price_discrepancy_resolved`.

---

## Cómo añadir un 8º servicio

1. Añade la clave a `ManualServiceKey` y una entrada en `MANUAL_ENTRY_SURVEYS`
   (`src/shared/manualEntry/manualEntrySchema.ts`), con sus pasos, rangos y microcopy. Si tiene rangos
   numéricos, añádelos a `MANUAL_RANGES`.
2. Añade una rama en `buildManualBookingPatch` (`manualEntryBuilders.ts`) que mapee las respuestas a la
   colección que consume el motor (reutiliza los adapters existentes).
3. Añade una rama en `validateManualBookingInput` (`manualEntryValidation.ts`).
4. Asegúrate de que `resolveManualServiceKey` reconoce el nombre del servicio.
5. Añade el servicio a los tests parametrizados de `manualEntryBuilders.test.ts` (cotización elegible) y
   al smoke de `ManualEntryWizardServices.test.tsx`.

Nada más: el wizard, la validación de servidor, la auditoría y el flujo de discrepancia son genéricos.

---

## Pruebas

```
npx vitest run src/shared/manualEntry/ \
  src/pages/reserva/manualEntryBuilders.test.ts \
  src/pages/reserva/manualCorrectionRecompute.test.ts \
  src/components/booking/manual/
```

Cubren: validación por servicio (in/out of range, enum, integer), paridad manual↔IA en el motor,
cotización elegible para los 7 servicios, navegación del wizard + gating de consentimiento + rechazo de
fuera de rango, hash/versión del texto legal, gate de validación de servidor y recompute de corrección.
