# Prompt 04 — Formulario "Quiero ser jardinero": rematar validaciones, subidas y reenvío

> Sesión nueva, en frío. Proyecto **GarSer** (React+Vite+TS, Supabase). Apóyate en la skill **`garser-production-audit`** para el barrido de bugs.

## Estado actual (verificado 2026-07-11) — 3 bugs YA corregidos

Archivo principal: `src/components/gardener/GardenerApplicationWizard.tsx` (~590 líneas), wizard de 6 pasos con autosave en `localStorage` y submit a la tabla de solicitudes. Revisión admin: `src/components/admin/ApplicationsAdmin.tsx` (dispara email al aprobar/rechazar, ver prompt 06).

Corregido el 2026-07-10 (comprueba con `git log` si está commiteado):

1. ✅ **Desbroce añadido** a `SERVICES` (líneas 11-21): ya están los 7 servicios canónicos;
   antes ningún jardinero podía declarar desbroce y nunca salía elegible para ese servicio.
2. ✅ **Barra de progreso**: ahora `(step-1)/(totalSteps-1)` → 100% en el paso 6 (línea ~79).
3. ✅ **Preguntas muertas resucitadas**: `workedForCompanies` / `canProve` ahora se renderizan
   como checkboxes en el paso 4 (líneas ~419-441) y se persisten en
   `worked_for_companies` / `can_prove` (antes se enviaban siempre `false`).

## Qué falta para producción completa

1. **Mapa completo pregunta ↔ estado ↔ columna** en la tabla **`gardener_applications`**
   (insert/update en `GardenerApplicationWizard.tsx:167/185/239`; archivos al bucket de
   Storage `applications`, `:204-206`). Sin campos huérfanos en ninguna dirección.
2. **Validaciones por paso**:
   - Teléfono con formato (hoy solo exige no-vacío, `isStepValid`, `:82`). Además el input
     es de texto plano (`:325`): ponerle `type="tel"` + `autoComplete="tel"` para que en
     móvil salga el teclado numérico.
   - Años de experiencia numérico ≥ 0.
   - Foto de perfil: que realmente se haya **subido** (URL en Storage), no solo seleccionada.
   - **Paso 5 siempre válido** (`isStepValid` retorna `true` con comentario dubitativo):
     decidir si formación es opcional de verdad y dejarlo intencional y documentado.
3. **Subidas a Storage** (avatar, pruebas de experiencia, certificados): manejo de error si
   falla la subida (estados `isUploadingAvatar/Proof/Cert`), reintento, y que la URL final
   quede guardada en la solicitud.
4. **Autosave `localStorage`**: restaura bien a mitad de wizard (recarga en paso 3-4) y se
   **limpia** tras enviar con éxito (que no reaparezca una solicitud vieja).
5. **Reenvío tras rechazo**: el email de rechazo enlaza a "Volver a solicitar" — verificar
   que el flujo permite corregir y reenviar, y que `ApplicationsAdmin` ve la nueva versión.
6. **UX mobile-first** del wizard (es de cara al **jardinero**: NO usar la skill
   `diseno-web-cliente`):
   - Botón "Siguiente" accesible con el teclado abierto (sticky abajo + safe-area).
   - Errores visibles junto al campo, no solo bloqueando el botón (hoy `isStepValid`
     deshabilita sin explicar qué falta).
   - **Compresión client-side de imágenes** antes de subir (avatar, pruebas, CV
     fotografiado): una foto de móvil de 5-10 MB por 3G tarda y falla; comprimir a ~1600px.
   - Indicador de progreso de subida (hoy solo estados booleanos `isUploading*`).
   - Los checkboxes nuevos del paso 4 son `w-4 h-4` (16px): ampliar el área táctil con
     padding en el `<label>` (ya son clicables por label, verificar altura ≥44px).
   - Autoguardado: mostrar "Borrador guardado" discreto para dar confianza de que no se
     pierde nada al salir.

## Verificación

`npm run dev` → recorrer el wizard completo como usuario nuevo (incluye marcar desbroce y las preguntas de empresas), enviar, y verificar en Supabase que TODAS las respuestas quedan guardadas. Probar: recarga a mitad (autosave), envío con red caída (error de subida), y reenvío tras rechazo desde `ApplicationsAdmin`.

## Restricciones

- La lista `SERVICES` debe seguir alineada con la fuente canónica (`enforce_canonical_services.js` / tabla `services`). No inventar nombres.
- Cambios de esquema → migración en `supabase/migrations/`.
